"""dsh-tang-agent · 三省六部核心流转逻辑（Python 参考实现）.

流程
----
    皇帝下旨 → 中书省起草 → 门下省朱批 ──准奏──→ 尚书省下发 → 六部执行 → 覆命
                                   │
                                   └─驳回（最多 3 次）→ 中书省修订
                                        连驳 3 次 → 封还圣旨，上报皇帝

本模块是一套可测试、可序列化的确定性实现：
- `TangCourt` 负责状态机与审计轨迹；
- `DefaultPlanner / DefaultReviewer / DefaultExecutor` 是不依赖大模型的
  默认实现，便于离线演示与单元测试；
- 换成真实 LLM 时，只需实现同签名的 `draft / review / execute` 三个
  可调用对象，状态机与防死锁逻辑不变。

侧边栏 UI 的 JS 引擎（engine.js）与本文件保持同一套阶段、字段与语义。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Callable, Dict, List, Optional

try:  # 兼容包内相对导入与 `python graph.py` 直接运行
    from .prompts import MINISTRIES, MINISTRY_ORDER
except ImportError:  # pragma: no cover - 直接运行脚本时
    from prompts import MINISTRIES, MINISTRY_ORDER


# ---------------------------------------------------------------------------
# 阶段与数据结构
# ---------------------------------------------------------------------------


class Stage(str, Enum):
    """圣旨流转阶段。"""

    IDLE = "idle"
    DRAFTING = "drafting"
    REVIEWING = "reviewing"
    REVISING = "revising"
    DISPATCHING = "dispatching"
    EXECUTING = "executing"
    COMPLETED = "completed"
    ESCALATED = "escalated"


STAGE_LABELS: Dict[str, str] = {
    Stage.IDLE.value: "静候圣旨",
    Stage.DRAFTING.value: "中书起草",
    Stage.REVIEWING.value: "门下朱批",
    Stage.REVISING.value: "封还重拟",
    Stage.DISPATCHING.value: "尚书下发",
    Stage.EXECUTING.value: "六部奉行",
    Stage.COMPLETED.value: "六部覆命",
    Stage.ESCALATED.value: "封还御前",
}

TONE = ("neutral", "ok", "warn", "bad")


@dataclass
class MinistryOrder:
    """一道下发给某部的条陈。"""

    ministry: str
    name: str
    objective: str
    deliverable: str
    tools: List[str]
    deadline: str = "旬日"
    wave: int = 2

    def to_dict(self) -> Dict[str, object]:
        return {
            "ministry": self.ministry,
            "name": self.name,
            "objective": self.objective,
            "deliverable": self.deliverable,
            "tools": list(self.tools),
            "deadline": self.deadline,
            "wave": self.wave,
        }


@dataclass
class Draft:
    """中书省草案。"""

    revision: int
    summary: str
    orders: List[MinistryOrder]
    risks: List[str]
    acceptance: List[str]
    notes: str = ""

    def to_dict(self) -> Dict[str, object]:
        return {
            "revision": self.revision,
            "summary": self.summary,
            "orders": [order.to_dict() for order in self.orders],
            "risks": list(self.risks),
            "acceptance": list(self.acceptance),
            "notes": self.notes,
        }


@dataclass
class Review:
    """门下省朱批。"""

    approved: bool
    comment: str
    issues: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        return {
            "approved": self.approved,
            "comment": self.comment,
            "issues": list(self.issues),
        }


@dataclass
class MinistryResult:
    """六部覆命。"""

    ministry: str
    name: str
    status: str
    summary: str
    artifacts: List[str]
    metrics: Dict[str, str]

    def to_dict(self) -> Dict[str, object]:
        return {
            "ministry": self.ministry,
            "name": self.name,
            "status": self.status,
            "summary": self.summary,
            "artifacts": list(self.artifacts),
            "metrics": dict(self.metrics),
        }


@dataclass
class HistoryEntry:
    """起居注：每一步都留痕，供侧边栏回放。"""

    seq: int
    actor: str
    action: str
    detail: str
    tone: str = "neutral"
    at: str = ""

    def to_dict(self) -> Dict[str, object]:
        return {
            "seq": self.seq,
            "actor": self.actor,
            "action": self.action,
            "detail": self.detail,
            "tone": self.tone,
            "at": self.at,
        }


@dataclass
class CourtRun:
    """一次完整的圣旨流转。"""

    id: str
    edict: str
    max_rejections: int = 3
    stage: Stage = Stage.IDLE
    revision: int = 0
    rejections: int = 0
    draft: Optional[Draft] = None
    review: Optional[Review] = None
    results: List[MinistryResult] = field(default_factory=list)
    history: List[HistoryEntry] = field(default_factory=list)
    escalation_reason: str = ""
    created_at: str = ""
    finished_at: str = ""

    # -- 视图 ---------------------------------------------------------------

    @property
    def stage_label(self) -> str:
        return STAGE_LABELS.get(self.stage.value, self.stage.value)

    @property
    def completed(self) -> bool:
        return self.stage == Stage.COMPLETED

    @property
    def escalated(self) -> bool:
        return self.stage == Stage.ESCALATED

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "edict": self.edict,
            "stage": self.stage.value,
            "stage_label": self.stage_label,
            "revision": self.revision,
            "rejections": self.rejections,
            "max_rejections": self.max_rejections,
            "draft": self.draft.to_dict() if self.draft else None,
            "review": self.review.to_dict() if self.review else None,
            "results": [result.to_dict() for result in self.results],
            "history": [entry.to_dict() for entry in self.history],
            "escalation_reason": self.escalation_reason,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }

    def summary(self) -> str:
        if self.escalated:
            return "门下省连驳 {n} 次，封还圣旨，直呈御前。".format(n=self.rejections)
        if self.completed:
            return "六部覆命：{n} 部办结，圣旨已毕。".format(n=len(self.results))
        return "圣旨流转中：{label}（第 {rev} 稿）。".format(
            label=self.stage_label, rev=max(self.revision, 1)
        )


# ---------------------------------------------------------------------------
# 默认中书省 · Planner
# ---------------------------------------------------------------------------


def _stable_seed(text: str) -> int:
    """djb2，与 engine.js 的 hashSeed 完全一致。

    两边用同一种哈希，同一道圣旨在 Python CLI 与侧边栏里会得到同一组
    限期与度支数字，便于对照与截图复现。
    """
    value = text or ""
    seed = 5381
    for char in value:
        seed = (seed * 33 + ord(char)) & 0xFFFFFFFF
    return seed


def _excerpt(text: str, limit: int = 60) -> str:
    clean = " ".join(text.split())
    return clean if len(clean) <= limit else clean[:limit] + "……"


class DefaultPlanner:
    """规则型中书令：把圣旨拆成六部条陈。

    第一稿刻意不写“风险预案”和“验收标准”，用来演示门下省封驳；
    第二稿（revision >= 2）补齐，因此默认流程会经历一次完整的
    “驳回 → 修订 → 准奏”，侧边栏打开即可看到朱批动画。
    """

    _FOCUS = {
        "works": "将圣旨落为可交付之物：图样、工序、验收节点，一件不可缺。",
        "justice": "为圣旨划定律令红线：合规审查、风险分级、处置预案。",
        "war": "把差事排成可执行的次序：关键路径、人手调度、应急后备。",
        "rites": "把朝廷决定写成得体文字：告示口径、仪注、对外辞令。",
        "revenue": "核算钱粮用度：预算科目、拨付次序、缺口与节流之法。",
        "personnel": "为差事配人：主事、协办、复核、考成与赏罚。",
    }

    _DEADLINES = ["三日", "五日", "旬日", "半月", "不拘"]

    def draft(
        self,
        edict: str,
        revision: int,
        previous: Optional[Draft] = None,
    ) -> Draft:
        seed = _stable_seed(edict)
        orders: List[MinistryOrder] = []
        for index, key in enumerate(MINISTRY_ORDER):
            meta = MINISTRIES[key]
            orders.append(
                MinistryOrder(
                    ministry=key,
                    name=str(meta["name"]),
                    objective=self._objective(key, edict),
                    deliverable=self._deliverable(key, edict),
                    tools=[str(tool) for tool in meta["tools"]],
                    deadline=self._DEADLINES[(seed + index) % len(self._DEADLINES)],
                    wave=1 if key == "works" else 2,
                )
            )

        risks: List[str] = []
        acceptance: List[str] = []
        notes = "初拟，恭候门下省朱批。"
        if revision >= 2:
            risks = [
                "工期风险：关键路径若遇料具不齐，工期顺延；工部预设三日缓冲。",
                "钱粮风险：预算若超支一成，户部即启节流与分期拨付。",
                "协同风险：六部并行若令出多门，尚书省按里程碑统一督办。",
            ]
            acceptance = [
                "六部交付物齐备，且经门下省抽验关键节点。",
                "预算、工期、风险三项与草案一致，偏差须书面说明。",
                "圣旨目标可逐条对应到条陈，无遗漏、无越权。",
            ]
            notes = "依门下省驳议修订：补风险预案与验收标准，余条不变。"
            if previous is not None:
                notes += "（据第 {n} 稿）".format(n=previous.revision)

        summary = (
            "奉天承运皇帝诏曰：{edict}。臣中书省谨拟六部条陈："
            "工部营造、刑部法度、兵部调度、礼部文告、户部钱粮、吏部考成，"
            "各专其职，并行而不相害。{tail}"
        ).format(
            edict=_excerpt(edict, 80),
            tail="" if revision == 1 else "风险与验收已备，恭请圣裁。",
        )

        return Draft(
            revision=revision,
            summary=summary,
            orders=orders,
            risks=risks,
            acceptance=acceptance,
            notes=notes,
        )

    def _objective(self, key: str, edict: str) -> str:
        return "{focus} 圣旨要点：{excerpt}".format(
            focus=self._FOCUS[key], excerpt=_excerpt(edict, 48)
        )

    def _deliverable(self, key: str, edict: str) -> str:
        mapping = {
            "works": "营造图样、工序分解、可验收交付件",
            "justice": "合规意见书、风险清单、红线处置建议",
            "war": "调度图、里程碑、应急预案",
            "rites": "告示文稿、仪注单、对外口径",
            "revenue": "预算表、拨付次序、节流方案",
            "personnel": "差遣表、考成法、复核名单",
        }
        return mapping[key]


# ---------------------------------------------------------------------------
# 默认门下省 · Reviewer
# ---------------------------------------------------------------------------


class DefaultReviewer:
    """规则型门下侍中：六条审核，缺一即驳。"""

    def review(self, draft: Draft, edict: str, attempt: int = 1) -> Review:
        issues: List[str] = []
        if len(draft.orders) != len(MINISTRY_ORDER):
            issues.append(
                "分职不备：应有六部条陈，今仅 {n} 部。".format(n=len(draft.orders))
            )
        if not draft.risks:
            issues.append("未列风险预案：须写明触发条件与应对之策。")
        if not draft.acceptance:
            issues.append("未列验收标准：交付物无从检验。")
        for order in draft.orders:
            if not order.deliverable.strip():
                issues.append("{name}条陈无交付物。".format(name=order.name))
        if len(draft.summary.strip()) < 10:
            issues.append("草案主旨含混，不足以服众。")

        approved = not issues
        if approved:
            comment = (
                "准奏。六部条陈齐备，风险有备，验收有据，"
                "可付尚书省施行。"
            )
        else:
            comment = "驳回。{first} 其余各条，着中书省一并修订。".format(
                first=issues[0]
            )
        return Review(approved=approved, comment=comment, issues=issues)


class RejectAllReviewer:
    """演示/测试用：永远驳回，用于验证“连驳三次即上报”。"""

    def review(self, draft: Draft, edict: str, attempt: int = 1) -> Review:
        issues = ["草案与圣旨本意仍有出入，着即重拟。"]
        return Review(
            approved=False,
            comment="驳回。第 {n} 次封还，中书省再拟。".format(n=attempt),
            issues=issues,
        )


# ---------------------------------------------------------------------------
# 默认六部工具
# ---------------------------------------------------------------------------


def draw_blueprint(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "《{name}营造图样》".format(name=order.name),
        "metrics": {"工序": "{n} 道".format(n=4 + seed % 5)},
    }


def estimate_works(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    days = 5 + seed % 20
    return {
        "artifact": "工期与料具估算表（{d} 日）".format(d=days),
        "metrics": {"工期": "{d} 日".format(d=days), "料具": "按图支给"},
    }


def check_statutes(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "《律令合规意见书》",
        "metrics": {"红线": "{n} 条".format(n=2 + seed % 3)},
    }


def assess_risk(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "风险清单与处置建议",
        "metrics": {"风险项": "{n} 项".format(n=3 + seed % 4)},
    }


def muster_route(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "并行调度图与关键路径",
        "metrics": {"役夫": "{n} 人".format(n=12 + seed % 30)},
    }


def schedule_guard(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "里程碑表与应急预案",
        "metrics": {"缓冲": "{n} 日".format(n=1 + seed % 3)},
    }


def draft_notice(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "《告示》与对外口径",
        "metrics": {"仪注": "{n} 条".format(n=3 + seed % 3)},
    }


def arrange_rites(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "仪注单与称谓表",
        "metrics": {"口径": "已统一"},
    }


def budget_ledger(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "预算表与拨付次序",
        "metrics": {"预算": "{n} 贯".format(n=80 + seed % 120)},
    }


def audit_grain(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "账目复核节点",
        "metrics": {"缺口": "{n} 贯".format(n=seed % 20)},
    }


def assign_officials(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "差遣表（主事/协办/复核）",
        "metrics": {"差遣": "{n} 员".format(n=3 + seed % 4)},
    }


def assign_subagent_roles(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "子 Agent 差遣表（主事/协办/复核）",
        "metrics": {"差遣": "{n} 员".format(n=3 + seed % 4), "协同": "主事/协办/复核"},
    }


def appraise_merit(order: MinistryOrder, edict: str, seed: int) -> Dict[str, object]:
    return {
        "artifact": "考成法与赏罚尺度",
        "metrics": {"考成": "三档九等"},
    }


MINISTRY_TOOLS: Dict[str, List[Callable[[MinistryOrder, str, int], Dict[str, object]]]] = {
    "works": [draw_blueprint, estimate_works],
    "justice": [check_statutes, assess_risk],
    "war": [muster_route, schedule_guard],
    "rites": [draft_notice, arrange_rites],
    "revenue": [budget_ledger, audit_grain],
    "personnel": [assign_subagent_roles],
}


class DefaultExecutor:
    """规则型六部：调用各部工具，产出结构化覆命。"""

    def execute(self, order: MinistryOrder, edict: str) -> MinistryResult:
        seed = _stable_seed(edict + order.ministry)
        artifacts: List[str] = []
        metrics: Dict[str, str] = {}
        for tool in MINISTRY_TOOLS[order.ministry]:
            out = tool(order, edict, seed)
            artifact = out.get("artifact")
            if artifact:
                artifacts.append(str(artifact))
            metrics.update(
                {str(k): str(v) for k, v in dict(out.get("metrics", {})).items()}
            )

        summary = "{name}奉旨办差：{deliverable}已成，限期{deadline}，恭候验收。".format(
            name=order.name,
            deliverable=order.deliverable,
            deadline=order.deadline,
        )
        return MinistryResult(
            ministry=order.ministry,
            name=order.name,
            status="done",
            summary=summary,
            artifacts=artifacts,
            metrics=metrics,
        )


# ---------------------------------------------------------------------------
# 状态机
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class TangCourt:
    """三省六部状态机。

    参数
    ----
    planner / reviewer / executor:
        与默认实现同签名的对象，可替换为真实 LLM 适配器。
    max_rejections:
        门下省连续驳回上限，默认 3；达到即封还圣旨、上报皇帝。
    clock:
        返回时间字符串的可调用对象，便于测试固定时间。
    """

    def __init__(
        self,
        planner: Optional[object] = None,
        reviewer: Optional[object] = None,
        executor: Optional[object] = None,
        max_rejections: int = 3,
        clock: Optional[Callable[[], str]] = None,
    ) -> None:
        if max_rejections < 1:
            raise ValueError("max_rejections 必须 >= 1")
        self.planner = planner or DefaultPlanner()
        self.reviewer = reviewer or DefaultReviewer()
        self.executor = executor or DefaultExecutor()
        self.max_rejections = max_rejections
        self.clock = clock or _now

    # -- 审计 ---------------------------------------------------------------

    def _log(
        self,
        run: CourtRun,
        actor: str,
        action: str,
        detail: str,
        tone: str = "neutral",
    ) -> None:
        run.history.append(
            HistoryEntry(
                seq=len(run.history) + 1,
                actor=actor,
                action=action,
                detail=detail,
                tone=tone if tone in TONE else "neutral",
                at=self.clock(),
            )
        )

    # -- 主流程 -------------------------------------------------------------

    def run(self, edict: str) -> CourtRun:
        text = (edict or "").strip()
        if not text:
            raise ValueError("圣旨不可为空")

        run = CourtRun(
            id="tang-" + hashlib.md5(text.encode("utf-8")).hexdigest()[:10],
            edict=text,
            max_rejections=self.max_rejections,
            created_at=self.clock(),
        )
        self._log(run, "皇帝", "下旨", text, "neutral")

        revision = 1
        previous: Optional[Draft] = None

        while True:
            run.stage = Stage.DRAFTING
            run.revision = revision
            draft = self.planner.draft(text, revision, previous)
            run.draft = draft
            self._log(
                run,
                "中书省",
                "草拟" if revision == 1 else "修订",
                "第 {n} 稿：{summary}".format(n=revision, summary=draft.summary),
                "neutral",
            )

            run.stage = Stage.REVIEWING
            review = self.reviewer.review(draft, text, revision)
            run.review = review
            tone = "ok" if review.approved else "warn"
            self._log(
                run,
                "门下省",
                "准奏" if review.approved else "驳回",
                review.comment
                + ("　驳议：" + "；".join(review.issues) if review.issues else ""),
                tone,
            )

            if review.approved:
                break

            run.rejections += 1
            if run.rejections >= self.max_rejections:
                run.stage = Stage.ESCALATED
                run.escalation_reason = (
                    "门下省连驳 {n} 次，依制封还圣旨，直呈御前，"
                    "着皇帝圣裁后再行。".format(n=run.rejections)
                )
                self._log(
                    run, "门下省", "封还", run.escalation_reason, "bad"
                )
                run.finished_at = self.clock()
                return run

            run.stage = Stage.REVISING
            self._log(
                run,
                "门下省",
                "封还重拟",
                "第 {n} 次驳回，限中书省修订后复奏。".format(n=run.rejections),
                "warn",
            )
            previous = draft
            revision += 1

        # 门下省放行
        run.stage = Stage.DISPATCHING
        self._log(
            run,
            "尚书省",
            "接旨",
            "奉门下省放行文书，六部条陈即日下发：" +
            "、".join(order.name for order in draft.orders),
            "ok",
        )

        run.stage = Stage.EXECUTING
        # 自定义 planner 可能没有显式 wave；按“工部先行”兜底，保证两波语义不漂移。
        if draft.orders and not any(order.wave == 1 for order in draft.orders):
            for order in draft.orders:
                if order.ministry == "works":
                    order.wave = 1
        for wave in (1, 2):
            wave_orders = [order for order in draft.orders if order.wave == wave]
            self._log(
                run,
                "尚书省",
                "第 {n} 波".format(n=wave),
                ("先派工部落盘，余部候其交付。" if wave == 1 else "工部已落盘，派刑、兵、礼、户、吏读取/统计/审查。"),
                "ok",
            )
            for order in wave_orders:
                result = self.executor.execute(order, text)
                run.results.append(result)
                self._log(
                    run,
                    order.name,
                    "覆命",
                    result.summary + "　交付：" + "、".join(result.artifacts),
                    "ok",
                )

        run.stage = Stage.COMPLETED
        self._log(
            run,
            "尚书省",
            "汇总覆命",
            "六部办结，交付物共 {n} 件，恭呈御览。".format(
                n=sum(len(result.artifacts) for result in run.results)
            ),
            "ok",
        )
        run.finished_at = self.clock()
        return run


def run_court(edict: str, **kwargs: object) -> CourtRun:
    """一行式入口：`run_court("...")`。"""
    return TangCourt(**kwargs).run(edict)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="dsh-tang-agent · 三省六部工作流：以三省六部制演练一道圣旨。"
    )
    parser.add_argument("edict", help="圣旨正文")
    parser.add_argument(
        "--reject-all",
        action="store_true",
        help="让门下省永远驳回，演示连驳三次封还御前",
    )
    parser.add_argument("--json", action="store_true", help="输出完整 JSON 轨迹")
    parser.add_argument(
        "--max-rejections", type=int, default=3, help="连驳上限，默认 3"
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    court = TangCourt(
        reviewer=RejectAllReviewer() if args.reject_all else None,
        max_rejections=args.max_rejections,
    )
    run = court.run(args.edict)
    if args.json:
        print(json.dumps(run.to_dict(), ensure_ascii=False, indent=2))
    else:
        print("圣旨：" + run.edict)
        for entry in run.history:
            print(
                "[{seq:02d}] {actor} · {action}：{detail}".format(
                    seq=entry.seq,
                    actor=entry.actor,
                    action=entry.action,
                    detail=entry.detail,
                )
            )
        print("-" * 60)
        print(run.summary())
    return 0 if not run.escalated else 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
