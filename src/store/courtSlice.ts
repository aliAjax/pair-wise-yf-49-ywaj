import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Evidence, Objection, SessionPhase, SessionState, TimelineEntry, CustodyRecord, HandoverRecord, ReleaseRecord, Role, SealStatus } from "../types";

const seedEvidence: Evidence[] = [
  { id: "e1", exhibitNo: "原告-003", title: "项目验收会议纪要", type: "书证", duration: 8, presenter: "原告", sensitive: false, status: "待展示", note: "第4页涉及合同补充约定", sealNo: "F-001", location: "A-01" },
  { id: "e2", exhibitNo: "原告-004", title: "设备故障检测报告", type: "书证", duration: 10, presenter: "原告", sensitive: true, status: "待展示", note: "含第三方客户名称，公开屏需遮罩", sealNo: "F-002", location: "A-02" },
  { id: "e3", exhibitNo: "被告-002", title: "系统运行日志", type: "电子数据", duration: 12, presenter: "被告", sensitive: false, status: "待展示", note: "重点展示 14:20 至 14:45", sealNo: "F-003", location: "A-03" }
];

const now = new Date().toISOString();
const seedCustody: CustodyRecord[] = [
  { evidenceId: "e1", sealNo: "F-001", location: "A-01", sealStatus: "完好", handovers: [
    { id: "h1", evidenceId: "e1", time: now, type: "入库", custodian: "张伟", sealNo: "F-001", location: "A-01", sealStatus: "完好", receiptStatus: "有回执", sealNote: "原始封条完好，入库登记" }
  ]},
  { evidenceId: "e2", sealNo: "F-002", location: "外借中", sealStatus: "完好", handovers: [
    { id: "h2", evidenceId: "e2", time: now, type: "入库", custodian: "张伟", sealNo: "F-002", location: "A-02", sealStatus: "完好", receiptStatus: "有回执", sealNote: "原始封条完好" },
    { id: "h3", evidenceId: "e2", time: now, type: "外借", custodian: "李娜", sealNo: "F-002", location: "外借中", sealStatus: "完好", receiptStatus: "无回执", sealNote: "外借封条完好，尚未归还" }
  ]},
  { evidenceId: "e3", sealNo: "F-003", location: "A-03", sealStatus: "完好", handovers: [
    { id: "h4", evidenceId: "e3", time: now, type: "入库", custodian: "张伟", sealNo: "F-003", location: "A-03", sealStatus: "完好", receiptStatus: "有回执", sealNote: "原始封条完好" },
    { id: "h5", evidenceId: "e3", time: now, type: "换袋", custodian: "王强", sealNo: "F-003", location: "A-03", sealStatus: "完好", receiptStatus: "无回执", sealNote: "现场换袋后封条完好，回执待补" }
  ]}
];

const seedSession: SessionState = { phase: "举证", currentEvidenceId: "e1", timerSeconds: 8 * 60, operatorMode: "庭审控制" };

interface State {
  initialized: boolean;
  evidence: Evidence[];
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: { id: string; label: string; time: string; evidence: Evidence[]; phase: SessionPhase; currentEvidenceId: string | null }[];
  session: SessionState;
  online: boolean;
  role: Role;
  custody: CustodyRecord[];
  releases: ReleaseRecord[];
  batchSeq: number;
}

const initialState: State = {
  initialized: false,
  evidence: seedEvidence,
  objections: [{ id: "o1", evidenceId: "e2", ground: "关联性异议", explanation: "检测报告来源和保管链尚未说明。", status: "待裁定", createdAt: new Date().toISOString() }],
  timeline: [{ id: "t1", time: new Date().toISOString(), actor: "书记员", action: "庭审开始", detail: "核对到庭人员并宣布法庭纪律" }],
  snapshots: [], session: seedSession, online: true, role: "书记员",
  custody: seedCustody, releases: [], batchSeq: 0
};

function addEntry(state: State, actor: TimelineEntry["actor"], action: string, detail: string) {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, detail });
}

/** 对账：证据条目与卷宗保管台账核对，返回拦下原因（空数组=放行） */
function runReconciliation(evidence: Evidence, custody: CustodyRecord): string[] {
  const reasons: string[] = [];
  if (evidence.sealNo !== custody.sealNo) reasons.push("封条编号不一致");
  if (evidence.location !== custody.location) reasons.push("存放位置不一致");
  if (custody.sealStatus === "破损") reasons.push("封条破损");
  const latest = custody.handovers[custody.handovers.length - 1];
  if (latest) {
    if (latest.type === "外借") reasons.push("外借未归还");
    if (latest.type === "换袋" && latest.receiptStatus === "无回执") reasons.push("换袋无回执");
  }
  return reasons;
}

/** 取该证据最近一条未结束的放行记录的批次号，否则开新批次 */
function resolveBatchNo(state: State, evidenceId: string): string {
  const open = state.releases.find((r) => r.evidenceId === evidenceId && (r.status === "拦下" || r.status === "退回待复核"));
  if (open) return open.batchNo;
  state.batchSeq += 1;
  return "P" + String(state.batchSeq).padStart(4, "0");
}

/** 执行核对并写入放行记录，返回结论 */
function performReconciliation(state: State, evidenceId: string, batchNo?: string): { pass: boolean; reasons: string[]; batchNo: string } {
  const evidence = state.evidence.find((e) => e.id === evidenceId);
  const custody = state.custody.find((c) => c.evidenceId === evidenceId);
  if (!evidence || !custody) return { pass: false, reasons: ["台账缺失"], batchNo: batchNo ?? "" };
  const finalBatchNo = batchNo ?? resolveBatchNo(state, evidenceId);
  const reasons = runReconciliation(evidence, custody);
  const pass = reasons.length === 0;
  state.releases.unshift({
    id: crypto.randomUUID(), batchNo: finalBatchNo, evidenceId,
    status: pass ? "放行" : "拦下", time: new Date().toISOString(), reasons,
    sealNo: custody.sealNo, location: custody.location
  });
  return { pass, reasons, batchNo: finalBatchNo };
}

/** 按核对结论同步证据展示状态 */
function applyResult(state: State, evidenceId: string, pass: boolean) {
  const evidence = state.evidence.find((e) => e.id === evidenceId);
  if (!evidence) return;
  if (pass) { if (evidence.status === "退回待复核") evidence.status = "展示中"; }
  else { if (evidence.status === "展示中") evidence.status = "退回待复核"; }
}

const slice = createSlice({
  name: "court",
  initialState,
  reducers: {
    initialize(state, action: PayloadAction<Evidence[]>) {
      if (!state.initialized) {
        const valid = action.payload.length > 0 && action.payload.every((e) => e.sealNo && e.location);
        state.evidence = valid ? action.payload : seedEvidence;
        state.initialized = true;
      }
    },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },
    setMode(state, action: PayloadAction<SessionState["operatorMode"]>) { state.session.operatorMode = action.payload; },
    setRole(state, action: PayloadAction<Role>) { state.role = action.payload; addEntry(state, "审判庭", "切换角色", `当前角色：${action.payload}`); },
    reorder(state, action: PayloadAction<Evidence[]>) { state.evidence = action.payload; addEntry(state, "书记员", "调整证据顺序", "已更新举证顺序"); },
    selectEvidence(state, action: PayloadAction<string>) { const item = state.evidence.find((entry) => entry.id === action.payload); if (!item) return; state.session.currentEvidenceId = item.id; state.session.timerSeconds = item.duration * 60; addEntry(state, item.presenter, "切换展示证据", `${item.exhibitNo} ${item.title}`); },
    showEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      const { pass, reasons } = performReconciliation(state, item.id);
      if (pass) {
        item.status = "展示中";
        state.session.phase = "质证";
        addEntry(state, item.presenter, "核对放行", `${item.exhibitNo} ${item.title} 封条与存放位置核对一致`);
      } else {
        addEntry(state, "书记员", "核对拦下", `${item.exhibitNo} ${item.title}：${reasons.join("、")}`);
      }
    },
    /** 重新核对（保留原批次，按同一批次重试） */
    reconcileEvidence(state, action: PayloadAction<string>) {
      const evidence = state.evidence.find((e) => e.id === action.payload);
      if (!evidence) return;
      const { pass, reasons } = performReconciliation(state, evidence.id);
      applyResult(state, evidence.id, pass);
      addEntry(state, "书记员", pass ? "重新核对放行" : "重新核对拦下", `${evidence.exhibitNo}：${reasons.join("、")}`);
    },
    /** 登记交接（外借 / 归还 / 换袋 / 入库），登记后重新核对 */
    registerHandover(state, action: PayloadAction<{ evidenceId: string; type: HandoverRecord["type"]; custodian: string; sealNo: string; location: string; sealStatus: SealStatus; receiptStatus: HandoverRecord["receiptStatus"]; sealNote: string }>) {
      const custody = state.custody.find((c) => c.evidenceId === action.payload.evidenceId);
      const evidence = state.evidence.find((e) => e.id === action.payload.evidenceId);
      if (!custody || !evidence) return;
      const record: HandoverRecord = { id: crypto.randomUUID(), time: new Date().toISOString(), ...action.payload };
      custody.handovers.push(record);
      if (action.payload.type === "外借") { custody.location = "外借中"; custody.sealNo = action.payload.sealNo; }
      else { custody.location = action.payload.location; custody.sealNo = action.payload.sealNo; }
      custody.sealStatus = action.payload.sealStatus;
      // 上屏后原件被外借或换袋：当前展示退回待复核，旧放行结论失效
      if ((action.payload.type === "外借" || action.payload.type === "换袋") && evidence.status === "展示中") {
        evidence.status = "退回待复核";
        const prev = state.releases.find((r) => r.evidenceId === evidence.id);
        if (prev) prev.status = "失效";
        performReconciliation(state, evidence.id);
      } else {
        const { pass, reasons } = performReconciliation(state, evidence.id);
        applyResult(state, evidence.id, pass);
        if (!pass) addEntry(state, "书记员", "交接登记", `${evidence.exhibitNo} ${action.payload.type}：${reasons.join("、")}`);
      }
      addEntry(state, "书记员", "交接登记", `${evidence.exhibitNo} ${action.payload.type}${evidence.status === "退回待复核" ? "，退回待复核" : ""}`);
    },
    /** 回执更新：旧放行结论失效，按原批次重新核对 */
    updateReceipt(state, action: PayloadAction<string>) {
      const handover = state.custody.flatMap((c) => c.handovers).find((h) => h.id === action.payload);
      if (!handover) return;
      handover.receiptStatus = "有回执";
      const evidence = state.evidence.find((e) => e.id === handover.evidenceId);
      const prev = state.releases.find((r) => r.evidenceId === handover.evidenceId);
      const batchNo = prev?.batchNo;
      if (prev) prev.status = "失效";
      const { pass, reasons } = performReconciliation(state, handover.evidenceId, batchNo);
      applyResult(state, handover.evidenceId, pass);
      addEntry(state, "书记员", "回执更新", `${evidence?.exhibitNo ?? ""} 旧结论失效，重新核对${pass ? "放行" : "拦下（" + reasons.join("、") + "）"}`);
    },
    /** 标记封条破损：在庭证据退回待复核，重新核对拦下 */
    markSealBroken(state, action: PayloadAction<string>) {
      const custody = state.custody.find((c) => c.evidenceId === action.payload);
      const evidence = state.evidence.find((e) => e.id === action.payload);
      if (!custody || !evidence) return;
      custody.sealStatus = "破损";
      const { pass, reasons } = performReconciliation(state, evidence.id);
      applyResult(state, evidence.id, pass);
      addEntry(state, "书记员", "封条破损", `${evidence.exhibitNo} 封条状态异常，退回待复核（${reasons.join("、")}）`);
    },
    completeEvidence(state) { const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId); if (!item) return; item.status = "已展示"; const next = state.evidence.find((entry) => entry.status === "待展示"); state.session.currentEvidenceId = next?.id ?? null; state.session.timerSeconds = (next?.duration ?? 0) * 60; state.session.phase = next ? "举证" : "休庭"; addEntry(state, "审判庭", "完成质证", item.title); },
    toggleSensitive(state, action: PayloadAction<string>) { const item = state.evidence.find((entry) => entry.id === action.payload); if (!item) return; item.sensitive = !item.sensitive; addEntry(state, "审判庭", item.sensitive ? "隐藏敏感内容" : "恢复公开内容", item.title); },
    addObjection(state, action: PayloadAction<{ evidenceId: string; ground: string; explanation: string }>) { const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId); state.objections.unshift({ ...action.payload, id: crypto.randomUUID(), status: "待裁定", createdAt: new Date().toISOString() }); state.session.phase = "质证"; addEntry(state, item?.presenter ?? "审判庭", "提出异议", `${item?.exhibitNo ?? ""} ${action.payload.ground}`); },
    resolveObjection(state, action: PayloadAction<{ id: string; status: "支持" | "驳回" }>) { const objection = state.objections.find((entry) => entry.id === action.payload.id); if (!objection) return; objection.status = action.payload.status; const item = state.evidence.find((entry) => entry.id === objection.evidenceId); if (action.payload.status === "支持" && item) { item.status = "已跳过"; addEntry(state, "审判庭", "异议成立", `${item.exhibitNo} 暂不展示`); } else { addEntry(state, "审判庭", "异议驳回", item?.title ?? "继续质证"); } },
    snapshot(state, action: PayloadAction<string>) { state.snapshots.unshift({ id: crypto.randomUUID(), label: action.payload, time: new Date().toISOString(), evidence: structuredClone(state.evidence), phase: state.session.phase, currentEvidenceId: state.session.currentEvidenceId }); state.snapshots = state.snapshots.slice(0, 10); },
    restore(state, action: PayloadAction<string>) { const snapshot = state.snapshots.find((entry) => entry.id === action.payload); if (!snapshot) return; state.evidence = structuredClone(snapshot.evidence); state.session.phase = snapshot.phase; state.session.currentEvidenceId = snapshot.currentEvidenceId; addEntry(state, "审判庭", "恢复庭审快照", snapshot.label); },
    tick(state) { if (state.session.phase === "质证" && state.session.timerSeconds > 0) state.session.timerSeconds -= 1; },
    setPhase(state, action: PayloadAction<SessionPhase>) { state.session.phase = action.payload; addEntry(state, "审判庭", "切换庭审阶段", action.payload); }
  }
});

export const { initialize, setOnline, setMode, setRole, reorder, selectEvidence, showEvidence, reconcileEvidence, registerHandover, updateReceipt, markSealBroken, completeEvidence, toggleSensitive, addObjection, resolveObjection, snapshot, restore, tick, setPhase } = slice.actions;
export default slice.reducer;
