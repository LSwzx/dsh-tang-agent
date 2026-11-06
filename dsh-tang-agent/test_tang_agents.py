"""dsh-tang-agent 单元测试.

覆盖：
1. 默认全流程：中书初拟 → 门下驳回 → 修订 → 准奏 → 六部覆命；
2. 连驳三次 → 封还圣旨、上报皇帝（防死锁）；
3. 一次准奏的顺利路径；
4. 六部条陈、独立工具与独立 System Prompt；
5. JSON 序列化、空圣旨校验、自定义连驳上限。

运行：
    python test_tang_agents.py -v
"""

import json
import unittest

from graph import (
    DefaultPlanner,
    RejectAllReviewer,
    Stage,
    TangCourt,
    run_court,
)
from prompts import MINISTRIES, MINISTRY_ORDER, all_prompts, build_minister_prompt

EDICT = "着工部于三月内修缮东市水渠，户部拨钱粮，刑部核验工料，吏部考成，礼部告示百姓。"


class ApproveFirstReviewer:
    """一次准奏的门下省替身。"""

    def review(self, draft, edict, attempt=1):
        from graph import Review

        return Review(approved=True, comment="准奏。", issues=[])


class TangCourtHappyPathTest(unittest.TestCase):
    def test_default_flow_rejects_once_then_completes(self):
        run = run_court(EDICT)

        self.assertEqual(run.stage, Stage.COMPLETED)
        self.assertTrue(run.completed)
        self.assertEqual(run.revision, 2, "默认应经历两稿：初拟 + 修订")
        self.assertEqual(run.rejections, 1, "默认应被门下省驳回一次")
        self.assertEqual(len(run.results), len(MINISTRY_ORDER))
        self.assertIsNotNone(run.draft)
        self.assertIsNotNone(run.review)
        self.assertTrue(run.review.approved)

        ministries = [result.ministry for result in run.results]
        self.assertEqual(ministries, MINISTRY_ORDER)
        for result in run.results:
            self.assertEqual(result.status, "done")
            self.assertTrue(result.summary)
            self.assertGreaterEqual(len(result.artifacts), 2)
            self.assertTrue(result.metrics)

    def test_rejection_and_approval_are_both_logged(self):
        run = run_court(EDICT)
        actions = [entry.action for entry in run.history]

        self.assertIn("下旨", actions)
        self.assertIn("草拟", actions)
        self.assertIn("驳回", actions)
        self.assertIn("修订", actions)
        self.assertIn("准奏", actions)
        self.assertIn("接旨", actions)
        self.assertIn("覆命", actions)
        self.assertIn("汇总覆命", actions)

        # 审计轨迹序号连续，可直接用于侧边栏回放。
        self.assertEqual(
            [entry.seq for entry in run.history],
            list(range(1, len(run.history) + 1)),
        )
        self.assertTrue(all(entry.at for entry in run.history))

    def test_approved_first_time_skips_revision(self):
        court = TangCourt(reviewer=ApproveFirstReviewer())
        run = court.run(EDICT)

        self.assertEqual(run.stage, Stage.COMPLETED)
        self.assertEqual(run.revision, 1)
        self.assertEqual(run.rejections, 0)
        self.assertEqual(len(run.results), 6)


class TangCourtDeadlockTest(unittest.TestCase):
    def test_three_rejections_escalate_to_emperor(self):
        court = TangCourt(reviewer=RejectAllReviewer(), max_rejections=3)
        run = court.run(EDICT)

        self.assertEqual(run.stage, Stage.ESCALATED)
        self.assertTrue(run.escalated)
        self.assertEqual(run.rejections, 3)
        self.assertEqual(run.results, [], "封还后不得再下发六部")
        self.assertIn("连驳 3 次", run.escalation_reason)
        self.assertIn("御前", run.escalation_reason)

        last = run.history[-1]
        self.assertEqual(last.actor, "门下省")
        self.assertEqual(last.action, "封还")
        self.assertEqual(last.tone, "bad")

        # 第 3 次驳回后不得进入“封还重拟”，避免死循环。
        self.assertNotIn(
            "封还重拟", [entry.action for entry in run.history[-2:]]
        )
        self.assertEqual(
            [entry.action for entry in run.history].count("驳回"), 3
        )

    def test_custom_rejection_limit(self):
        court = TangCourt(reviewer=RejectAllReviewer(), max_rejections=2)
        run = court.run(EDICT)

        self.assertEqual(run.stage, Stage.ESCALATED)
        self.assertEqual(run.rejections, 2)
        self.assertEqual(run.max_rejections, 2)

    def test_rejection_limit_must_be_positive(self):
        with self.assertRaises(ValueError):
            TangCourt(max_rejections=0)


class TangCourtDraftTest(unittest.TestCase):
    def test_draft_covers_all_six_ministries_with_tools(self):
        draft = DefaultPlanner().draft(EDICT, revision=1)

        self.assertEqual(len(draft.orders), 6)
        self.assertEqual([order.ministry for order in draft.orders], MINISTRY_ORDER)
        for order in draft.orders:
            self.assertTrue(order.objective)
            self.assertTrue(order.deliverable)
            self.assertGreaterEqual(len(order.tools), 2)
            self.assertTrue(order.deadline)

        # 初稿刻意缺风险与验收，复稿补齐。
        self.assertEqual(draft.risks, [])
        self.assertEqual(draft.acceptance, [])
        revised = DefaultPlanner().draft(EDICT, revision=2, previous=draft)
        self.assertGreaterEqual(len(revised.risks), 2)
        self.assertGreaterEqual(len(revised.acceptance), 2)

    def test_each_executor_result_uses_own_tools(self):
        run = run_court(EDICT)
        by_ministry = {result.ministry: result for result in run.results}

        self.assertIn("工期", by_ministry["works"].metrics)
        self.assertIn("风险项", by_ministry["justice"].metrics)
        self.assertIn("役夫", by_ministry["war"].metrics)
        self.assertIn("仪注", by_ministry["rites"].metrics)
        self.assertIn("预算", by_ministry["revenue"].metrics)
        self.assertIn("差遣", by_ministry["personnel"].metrics)


class PromptTest(unittest.TestCase):
    def test_all_prompts_present_and_distinct(self):
        prompts = all_prompts()
        expected = {
            "emperor",
            "zhongshu",
            "menxia",
            "shangshu",
            "works",
            "justice",
            "war",
            "rites",
            "revenue",
            "personnel",
        }
        self.assertEqual(set(prompts), expected)
        self.assertEqual(len(set(prompts.values())), len(prompts))

    def test_ministry_prompt_names_duty_and_tools(self):
        for key in MINISTRY_ORDER:
            meta = MINISTRIES[key]
            prompt = str(meta["system_prompt"])
            self.assertIn(str(meta["name"]), prompt)
            for tool in meta["tools"]:
                self.assertIn(tool, prompt)

    def test_build_minister_prompt_scopes_to_one_ministry(self):
        order = DefaultPlanner().draft(EDICT, revision=1).orders[0]
        prompt = build_minister_prompt("works", order.to_dict(), EDICT)

        self.assertIn("工部尚书", prompt)
        self.assertIn("draw_blueprint", prompt)
        self.assertNotIn("户部尚书", prompt)

    def test_six_ministry_tools_are_independent(self):
        tool_sets = [tuple(MINISTRIES[key]["tools"]) for key in MINISTRY_ORDER]
        self.assertEqual(len(set(tool_sets)), 6)
        self.assertTrue(all(len(tools) >= 2 for tools in tool_sets))


class SerializationTest(unittest.TestCase):
    def test_run_is_json_serializable(self):
        run = run_court(EDICT)
        payload = run.to_dict()
        text = json.dumps(payload, ensure_ascii=False)
        restored = json.loads(text)

        self.assertEqual(restored["stage"], "completed")
        self.assertEqual(restored["stage_label"], "六部覆命")
        self.assertEqual(len(restored["results"]), 6)
        self.assertEqual(len(restored["history"]), len(run.history))
        self.assertEqual(restored["draft"]["orders"][0]["ministry"], "works")

    def test_empty_edict_is_rejected(self):
        with self.assertRaises(ValueError):
            TangCourt().run("   ")


if __name__ == "__main__":
    unittest.main(verbosity=2)
