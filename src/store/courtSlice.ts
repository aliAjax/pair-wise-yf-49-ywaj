import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  BlockReason,
  Clearance,
  CustodyRecord,
  Evidence,
  HandoverEvent,
  HandoverType,
  Objection,
  Role,
  SessionPhase,
  SessionState,
  TimelineEntry
} from "../types";

const now = new Date();
function at(minuteOffset: number) {
  return new Date(now.getTime() + minuteOffset * 60000).toISOString();
}

const seedEvidence: Evidence[] = [
  { id: "e1", exhibitNo: "原告-003", title: "项目验收会议纪要", type: "书证", duration: 8, presenter: "原告", sensitive: false, status: "待展示", note: "第4页涉及合同补充约定", sealNo: "FY-2026-0031", location: "A区卷宗柜-07", handoverId: "h-e1-1" },
  { id: "e2", exhibitNo: "原告-004", title: "设备故障检测报告", type: "书证", duration: 10, presenter: "原告", sensitive: true, status: "待展示", note: "含第三方客户名称，公开屏需遮罩", sealNo: "FY-2026-0042", location: "A区卷宗柜-08", handoverId: "h-e2-2" },
  { id: "e3", exhibitNo: "被告-002", title: "系统运行日志", type: "电子数据", duration: 12, presenter: "被告", sensitive: false, status: "待展示", note: "重点展示 14:20 至 14:45", sealNo: "FY-2026-0076", location: "B区物证室-02", handoverId: "h-e3-1" }
];

const seedCustody: CustodyRecord[] = [
  {
    evidenceId: "e1", sealNo: "FY-2026-0031", sealIntact: true, location: "A区卷宗柜-07", custodian: "周文斌",
    loanedTo: null, loanedAt: null, lastHandoverId: "h-e1-1", awaitingReceipt: false,
    sealNote: "骑缝封条完好，签字与日期齐全",
    handovers: [
      { id: "h-e1-1", time: at(-180), type: "入库", custodian: "周文斌", detail: "当庭核验原件后入卷封存" }
    ]
  },
  {
    evidenceId: "e2", sealNo: "FY-2026-0042", sealIntact: true, location: "A区卷宗柜-08", custodian: "周文斌",
    loanedTo: null, loanedAt: null, lastHandoverId: "h-e2-2", awaitingReceipt: true,
    sealNote: "原封条 FY-2026-0042 随旧袋存档，新袋封条待贴",
    handovers: [
      { id: "h-e2-1", time: at(-200), type: "入库", custodian: "周文斌", detail: "庭前交换后封存入库" },
      { id: "h-e2-2", time: at(-40), type: "现场换袋", custodian: "李慎", detail: "原证物袋破损，当庭更换防拆袋，回执待补", receiptNo: "" }
    ]
  },
  {
    evidenceId: "e3", sealNo: "FY-2026-0076", sealIntact: false, location: "B区物证室-11", custodian: "李慎",
    loanedTo: null, loanedAt: null, lastHandoverId: "h-e3-2", awaitingReceipt: false,
    sealNote: "右上角封条起翘撕裂，需重新封存",
    handovers: [
      { id: "h-e3-1", time: at(-260), type: "入库", custodian: "李慎", detail: "电子介质封存入库" },
      { id: "h-e3-2", time: at(-90), type: "库位转移", custodian: "李慎", detail: "物证室柜位调整，转至 B-11" }
    ]
  }
];

const seedSession: SessionState = { phase: "举证", currentEvidenceId: "e1", timerSeconds: 8 * 60, operatorMode: "庭审控制", role: "书记员" };

interface State {
  initialized: boolean;
  evidence: Evidence[];
  custody: CustodyRecord[];
  clearances: Clearance[];
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: { id: string; label: string; time: string; evidence: Evidence[]; custody: CustodyRecord[]; clearances: Clearance[]; phase: SessionPhase; currentEvidenceId: string | null }[];
  session: SessionState;
  online: boolean;
}

const initialState: State = {
  initialized: false,
  evidence: seedEvidence,
  custody: seedCustody,
  clearances: [],
  objections: [{ id: "o1", evidenceId: "e2", ground: "关联性异议", explanation: "检测报告来源和保管链尚未说明。", status: "待裁定", createdAt: at(0) }],
  timeline: [{ id: "t1", time: at(0), actor: "书记员", action: "庭审开始", detail: "核对到庭人员并宣布法庭纪律", category: "庭审" }],
  snapshots: [], session: seedSession, online: true
};

function addEntry(state: State, actor: TimelineEntry["actor"], action: string, detail: string, category: TimelineEntry["category"] = "庭审") {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, detail, category });
}

function nextBatchId() {
  return "B" + Date.now().toString(36).toUpperCase() + crypto.randomUUID().slice(0, 4).toUpperCase();
}

function nextHandover(record: CustodyRecord, type: HandoverType, custodian: string, detail: string, receiptNo?: string) {
  const event: HandoverEvent = { id: crypto.randomUUID(), time: new Date().toISOString(), type, custodian, detail, ...(receiptNo !== undefined ? { receiptNo } : {}) };
  record.handovers.unshift(event);
  record.lastHandoverId = event.id;
  return event;
}

/** 条目与卷宗保管台账对账：封条编号、存放位置、最近交接记录一致，且无在途风险才放行 */
function evaluateGate(item: Evidence, record: CustodyRecord): { decision: "放行" | "拦下"; reasons: BlockReason[] } {
  const reasons: BlockReason[] = [];
  if (record.loanedTo) reasons.push("外借未归还");
  if (!record.sealIntact) reasons.push("封条破损");
  if (record.awaitingReceipt) reasons.push("现场换袋无回执");
  if (item.sealNo !== record.sealNo) reasons.push("封条编号不一致");
  if (item.location !== record.location) reasons.push("存放位置不一致");
  if (item.handoverId !== record.lastHandoverId) reasons.push("交接记录不一致");
  return { decision: reasons.length ? "拦下" : "放行", reasons };
}

/** 记录一次核对结论；同一批次重试沿用 batchId，attempt 递增。
 *  拦下批次未清或证据处于退回待复核时，重试仍属同一批次；放行结论失效后开启新批次 */
function conclude(state: State, item: Evidence, record: CustodyRecord, sameBatch: boolean): Clearance {
  const verdict = evaluateGate(item, record);
  const prior = [...state.clearances].find((entry) => entry.evidenceId === item.id);
  const continueBatch = sameBatch
    || (prior !== undefined && (prior.decision === "拦下" || item.status === "退回待复核"));
  const clearance: Clearance = {
    id: crypto.randomUUID(),
    evidenceId: item.id,
    batchId: continueBatch && prior ? prior.batchId : nextBatchId(),
    attempt: continueBatch && prior ? prior.attempt + 1 : 1,
    decision: verdict.decision,
    reasons: verdict.reasons,
    at: new Date().toISOString(),
    handoverId: record.lastHandoverId,
    stale: false
  };
  state.clearances.unshift(clearance);
  return clearance;
}

/** 台账发生变化：旧放行结论失效；原件若正在上屏，退回待复核（已讲时长保留在计时器中） */
function invalidateAfterLedgerChange(state: State, item: Evidence, action: string, detail: string) {
  for (const clearance of state.clearances) {
    if (clearance.evidenceId === item.id && clearance.decision === "放行") clearance.stale = true;
  }
  if (item.status === "展示中") {
    item.status = "退回待复核";
    addEntry(state, "书记员", action, `${detail}，当前展示退回待复核`, "保管交接");
  } else {
    addEntry(state, "书记员", action, detail, "保管交接");
  }
}

/** 按同一批次重新核对 */
function recheck(state: State, item: Evidence, record: CustodyRecord, trigger: string): Clearance {
  const clearance = conclude(state, item, record, true);
  if (clearance.decision === "放行") {
    if (item.status === "退回待复核") {
      item.status = "展示中";
      addEntry(state, "书记员", trigger, `${item.exhibitNo} 重新核对放行，恢复上屏，已讲时长继续计算`, "保管交接");
    } else {
      addEntry(state, "书记员", trigger, `${item.exhibitNo} 拦下的证据重新核对放行`, "保管交接");
    }
  } else {
    addEntry(state, "书记员", trigger, `${item.exhibitNo} 批次 ${clearance.batchId} 第 ${clearance.attempt} 次核对未通过，保留原批次继续重试：${clearance.reasons.join("、")}`, "保管交接");
  }
  return clearance;
}

const slice = createSlice({
  name: "court",
  initialState,
  reducers: {
    initialize(state, action: PayloadAction<{ evidence?: Evidence[]; custody?: CustodyRecord[]; clearances?: Clearance[] }>) {
      if (state.initialized) return;
      if (action.payload.evidence?.length) {
        // 兼容旧存档：补齐对账所需的封条、位置、交接点字段
        state.evidence = action.payload.evidence.map((stored) => {
          const seed = seedEvidence.find((entry) => entry.id === stored.id);
          return {
            ...seed,
            ...stored,
            sealNo: stored.sealNo ?? seed?.sealNo ?? `FY-${stored.id.toUpperCase()}`,
            location: stored.location ?? seed?.location ?? "待入库定位",
            handoverId: stored.handoverId ?? seed?.handoverId ?? `h-${stored.id}-seed`
          };
        });
      }
      if (action.payload.custody?.length) state.custody = action.payload.custody;
      if (action.payload.clearances) state.clearances = action.payload.clearances;
      state.initialized = true;
    },
    setRole(state, action: PayloadAction<Role>) { state.session.role = action.payload; },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },
    setMode(state, action: PayloadAction<SessionState["operatorMode"]>) { state.session.operatorMode = action.payload; },
    reorder(state, action: PayloadAction<Evidence[]>) { state.evidence = action.payload; addEntry(state, "书记员", "调整证据顺序", "已更新举证顺序"); },
    selectEvidence(state, action: PayloadAction<string>) { const item = state.evidence.find((entry) => entry.id === action.payload); if (!item) return; state.session.currentEvidenceId = item.id; state.session.timerSeconds = item.duration * 60; addEntry(state, item.presenter, "切换展示证据", `${item.exhibitNo} ${item.title}`); },
    /** 书记员推上公开屏：先与保管台账对账，放行才允许上屏 */
    showEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      const record = state.custody.find((entry) => entry.evidenceId === item.id);
      if (!record) return;
      const clearance = conclude(state, item, record, item.status === "退回待复核");
      if (clearance.decision === "拦下") {
        addEntry(state, "书记员", "证据上屏被拦", `${item.exhibitNo} 未通过台账对账：${clearance.reasons.join("、")}（批次 ${clearance.batchId} 第 ${clearance.attempt} 次）`, "保管交接");
        return;
      }
      if (item.status !== "退回待复核") state.session.timerSeconds = item.duration * 60;
      item.status = "展示中";
      state.session.phase = "质证";
      addEntry(state, item.presenter, "开始展示", `${item.title}，原件经台账对账放行（批次 ${clearance.batchId}）`);
    },
    /** 拦下后按同一批次重新核对 */
    recheckEvidence(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload);
      if (!item || !record) return;
      recheck(state, item, record, "重新核对证据");
    },
    /** 封条/位置/交接点不一致：台账核对确认后以台账更新条目，再按同批次重试 */
    certifyEntry(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload);
      if (!item || !record) return;
      item.sealNo = record.sealNo;
      item.location = record.location;
      const event = nextHandover(record, "条目核对", record.custodian, "条目与台账核对一致，条目基准更新", "");
      item.handoverId = event.id;
      recheck(state, item, record, "条目与台账核对一致");
    },
    completeEvidence(state) { const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId); if (!item || item.status !== "展示中") return; item.status = "已展示"; const next = state.evidence.find((entry) => entry.status === "待展示"); state.session.currentEvidenceId = next?.id ?? null; state.session.timerSeconds = (next?.duration ?? 0) * 60; state.session.phase = next ? "举证" : "休庭"; addEntry(state, "审判庭", "完成质证", item.title); },
    toggleSensitive(state, action: PayloadAction<string>) { const item = state.evidence.find((entry) => entry.id === action.payload); if (!item) return; item.sensitive = !item.sensitive; addEntry(state, "审判庭", item.sensitive ? "隐藏敏感内容" : "恢复公开内容", item.title); },
    addObjection(state, action: PayloadAction<{ evidenceId: string; ground: string; explanation: string }>) { const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId); state.objections.unshift({ ...action.payload, id: crypto.randomUUID(), status: "待裁定", createdAt: new Date().toISOString() }); state.session.phase = "质证"; addEntry(state, item?.presenter ?? "审判庭", "提出异议", `${item?.exhibitNo ?? ""} ${action.payload.ground}`); },
    resolveObjection(state, action: PayloadAction<{ id: string; status: "支持" | "驳回" }>) { const objection = state.objections.find((entry) => entry.id === action.payload.id); if (!objection) return; objection.status = action.payload.status; const item = state.evidence.find((entry) => entry.id === objection.evidenceId); if (action.payload.status === "支持" && item) { item.status = "已跳过"; addEntry(state, "审判庭", "异议成立", `${item.exhibitNo} 暂不展示`); } else { addEntry(state, "审判庭", "异议驳回", item?.title ?? "继续质证"); } },
    /** 原件外借：上屏中的退回待复核，未上屏的待上屏时拦下 */
    loanOut(state, action: PayloadAction<{ evidenceId: string; loanedTo: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload.evidenceId);
      if (!item || !record) return;
      record.loanedTo = action.payload.loanedTo;
      record.loanedAt = new Date().toISOString();
      nextHandover(record, "外借", record.custodian, `原件外借至 ${action.payload.loanedTo}，尚未归还`);
      invalidateAfterLedgerChange(state, item, "原件外借", `${item.exhibitNo} 外借至 ${action.payload.loanedTo}`);
    },
    /** 外借归还入册：回到在库状态，可按同批次重新核对 */
    returnOriginal(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload);
      if (!item || !record || !record.loanedTo) return;
      const from = record.loanedTo;
      record.loanedTo = null;
      record.loanedAt = null;
      const event = nextHandover(record, "归还", record.custodian, `外借原件自 ${from} 归还，核验后归位 ${record.location}`);
      item.handoverId = event.id;
      invalidateAfterLedgerChange(state, item, "外借原件归还", `${item.exhibitNo} 自 ${from} 归还入册`);
    },
    /** 现场换袋：未带回执前拦下；上屏中的退回待复核 */
    replaceBag(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload);
      if (!item || !record) return;
      record.awaitingReceipt = true;
      nextHandover(record, "现场换袋", record.custodian, "当庭更换防拆证物袋，回执待补", "");
      invalidateAfterLedgerChange(state, item, "现场更换证物袋", `${item.exhibitNo} 已换袋，回执尚未回传`);
    },
    /** 回执一更新：旧放行结论全部失效，拦下的证据按同一批次自动重新核对 */
    registerReceipt(state, action: PayloadAction<{ evidenceId: string; receiptNo: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload.evidenceId);
      if (!item || !record) return;
      record.awaitingReceipt = false;
      const pending = record.handovers.find((event) => event.type === "现场换袋" && !event.receiptNo);
      if (pending) pending.receiptNo = action.payload.receiptNo;
      else nextHandover(record, "回执登记", record.custodian, `换袋回执 ${action.payload.receiptNo} 已回传登记`, action.payload.receiptNo);
      item.handoverId = record.lastHandoverId;
      for (const clearance of state.clearances) if (clearance.evidenceId === item.id) clearance.stale = true;
      addEntry(state, "书记员", "换袋回执更新", `${item.exhibitNo} 回执 ${action.payload.receiptNo} 已登记，此前放行结论失效`, "保管交接");
      recheck(state, item, record, "回执更新后重新核对");
    },
    /** 封条破损登记 */
    markSealBroken(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload);
      if (!item || !record) return;
      record.sealIntact = false;
      record.sealNote = "封条破损，等待重新封存";
      nextHandover(record, "封条检查", record.custodian, "巡检发现封条破损，暂停调用", "");
      invalidateAfterLedgerChange(state, item, "封条破损登记", `${item.exhibitNo} 封条破损，禁止放行`);
    },
    /** 重新封存换封：新封条号入台账，条目需核对一致后放行 */
    reseal(state, action: PayloadAction<{ evidenceId: string; newSealNo: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload.evidenceId);
      if (!item || !record) return;
      record.sealNo = action.payload.newSealNo;
      record.sealIntact = true;
      record.sealNote = "已重新封存，新封条完好";
      nextHandover(record, "重新封存", record.custodian, `重新封存，新封条编号 ${action.payload.newSealNo}`);
      invalidateAfterLedgerChange(state, item, "证据重新封存", `${item.exhibitNo} 启用新封条 ${action.payload.newSealNo}，条目待核对`);
    },
    /** 库内移位（台账侧变化，条目需核对一致后放行） */
    transferLocation(state, action: PayloadAction<{ evidenceId: string; newLocation: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      const record = state.custody.find((entry) => entry.evidenceId === action.payload.evidenceId);
      if (!item || !record) return;
      record.location = action.payload.newLocation;
      nextHandover(record, "库位转移", record.custodian, `库内移位至 ${action.payload.newLocation}`);
      invalidateAfterLedgerChange(state, item, "保管库位调整", `${item.exhibitNo} 移至 ${action.payload.newLocation}，条目待核对`);
    },
    snapshot(state, action: PayloadAction<string>) { state.snapshots.unshift({ id: crypto.randomUUID(), label: action.payload, time: new Date().toISOString(), evidence: structuredClone(state.evidence), custody: structuredClone(state.custody), clearances: structuredClone(state.clearances), phase: state.session.phase, currentEvidenceId: state.session.currentEvidenceId }); state.snapshots = state.snapshots.slice(0, 10); },
    restore(state, action: PayloadAction<string>) { const snapshot = state.snapshots.find((entry) => entry.id === action.payload); if (!snapshot) return; state.evidence = structuredClone(snapshot.evidence); state.custody = structuredClone(snapshot.custody); state.clearances = structuredClone(snapshot.clearances); state.session.phase = snapshot.phase; state.session.currentEvidenceId = snapshot.currentEvidenceId; addEntry(state, "审判庭", "恢复庭审快照", snapshot.label); },
    tick(state) { if (state.session.phase === "质证" && state.session.timerSeconds > 0) { const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId); if (item?.status === "展示中") state.session.timerSeconds -= 1; } },
    setPhase(state, action: PayloadAction<SessionPhase>) { state.session.phase = action.payload; addEntry(state, "审判庭", "切换庭审阶段", action.payload); }
  }
});

export const {
  initialize, setRole, setOnline, setMode, reorder, selectEvidence, showEvidence, recheckEvidence, certifyEntry,
  completeEvidence, toggleSensitive, addObjection, resolveObjection, loanOut, returnOriginal, replaceBag,
  registerReceipt, markSealBroken, reseal, transferLocation, snapshot, restore, tick, setPhase
} = slice.actions;
export default slice.reducer;
