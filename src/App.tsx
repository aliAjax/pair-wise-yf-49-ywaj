import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, Message, Modal, Radio, Select, Space, Statistic, Switch, Tag, Timeline } from "@arco-design/web-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { NavLink, Route, Routes } from "react-router-dom";
import { useSaveCourtMutation, useGetCourtQuery } from "./store/api";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import {
  addObjection, certifyEntry, completeEvidence, initialize, loanOut, markSealBroken, recheckEvidence, reorder,
  replaceBag, reseal, resolveObjection, restore, returnOriginal, selectEvidence, setMode, setOnline, setPhase,
  setRole, showEvidence, snapshot, tick, toggleSensitive, transferLocation, registerReceipt
} from "./store/courtSlice";
import type { BlockReason, Clearance, CustodyRecord, Evidence, Role, SessionPhase } from "./types";

const objectionSchema = z.object({ ground: z.string().min(2), explanation: z.string().min(6) });
type ObjectionForm = z.infer<typeof objectionSchema>;

function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

const reasonColor: Record<BlockReason, string> = {
  外借未归还: "red", 封条破损: "red", 现场换袋无回执: "red",
  封条编号不一致: "orange", 存放位置不一致: "orange", 交接记录不一致: "orange"
};

function latestClearanceOf(clearances: Clearance[], evidenceId: string) {
  return clearances.find((entry) => entry.evidenceId === evidenceId);
}

/** 放行结论标记：代理人只见放行/拦下结论，看不到封条、保管人等交接明细 */
function GateTag({ clearance, size }: { clearance: Clearance | undefined; size?: "small" | "default" }) {
  if (!clearance) return <Tag size={size} color="gray">未对账</Tag>;
  if (clearance.decision === "拦下") return <Tag size={size} color="red">拦下 · 批次 {clearance.batchId}</Tag>;
  if (clearance.stale) return <Tag size={size} color="orange">结论失效待重核</Tag>;
  return <Tag size={size} color="green">已放行 · 批次 {clearance.batchId}</Tag>;
}

/** 台账操作弹窗（仅书记员） */
type LedgerPrompt =
  | { kind: "loan"; record: CustodyRecord }
  | { kind: "receipt"; record: CustodyRecord }
  | { kind: "reseal"; record: CustodyRecord }
  | { kind: "transfer"; record: CustodyRecord };

const promptMeta: Record<LedgerPrompt["kind"], { title: string; label: string; placeholder: string; initial: (record: CustodyRecord) => string }> = {
  loan: { title: "原件外借登记", label: "外借去向（借调单位/人员）", placeholder: "例如：司法鉴定中心", initial: () => "" },
  receipt: { title: "换袋回执登记", label: "回执编号", placeholder: "例如：HZ-2026-1008", initial: () => `HZ-2026-${Math.floor(1000 + Math.random() * 9000)}` },
  reseal: { title: "重新封存换封", label: "新封条编号", placeholder: "例如：FY-2026-0101", initial: (record) => `FY-2026-${Math.floor(100 + Math.random() * 900)}` },
  transfer: { title: "库内移位登记", label: "新存放位置", placeholder: "例如：C区物证室-03", initial: () => "" }
};

function CustodyLedger() {
  const state = useAppSelector((root) => root.court);
  const dispatch = useAppDispatch();
  const isAgent = state.session.role === "代理人";
  const isClerk = state.session.role === "书记员";
  const [prompt, setPrompt] = useState<LedgerPrompt | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const openPrompt = (next: LedgerPrompt) => { setPrompt(next); setPromptValue(promptMeta[next.kind].initial(next.record)); };
  const submitPrompt = () => {
    if (!prompt) return;
    if (!promptValue.trim()) { Message.warning("请先填写登记内容"); return; }
    const id = prompt.record.evidenceId;
    if (prompt.kind === "loan") dispatch(loanOut({ evidenceId: id, loanedTo: promptValue.trim() }));
    if (prompt.kind === "receipt") dispatch(registerReceipt({ evidenceId: id, receiptNo: promptValue.trim() }));
    if (prompt.kind === "reseal") dispatch(reseal({ evidenceId: id, newSealNo: promptValue.trim() }));
    if (prompt.kind === "transfer") dispatch(transferLocation({ evidenceId: id, newLocation: promptValue.trim() }));
    Message.success(prompt.kind === "receipt" ? "回执已登记，旧放行结论失效，拦下证据已按同批次重新核对" : "台账已更新");
    setPrompt(null);
  };

  return <Card
    title="卷宗保管台账对账"
    extra={<Tag color={isClerk ? "gold" : "gray"}>{state.session.role}视图{isAgent ? "（仅结论）" : ""}</Tag>}
  >
    <div className="custody-list">
      {state.evidence.map((item) => {
        const record = state.custody.find((entry) => entry.evidenceId === item.id);
        const clearance = latestClearanceOf(state.clearances, item.id);
        if (!record) return null;
        const mismatch = item.sealNo !== record.sealNo || item.location !== record.location || item.handoverId !== record.lastHandoverId;
        return <article key={item.id} className="custody-row">
          <div className="custody-head">
            <b>{item.exhibitNo} · {item.title}</b>
            <GateTag clearance={clearance} />
          </div>
          {isAgent ? (
            <p className="agent-result">代理人仅可见放行结论：{clearance?.decision === "放行" && !clearance.stale ? "原件已核对放行" : clearance?.stale ? "原放行结论已失效，等待重新核对" : "原件尚未放行"}</p>
          ) : <>
            <div className="custody-fields">
              <div><small>封条编号</small><span className={item.sealNo !== record.sealNo ? "mismatch" : ""}>{record.sealNo}{item.sealNo !== record.sealNo && <em> 条目：{item.sealNo}</em>}</span></div>
              <div><small>封条状态</small><span className={record.sealIntact ? "" : "mismatch"}>{record.sealIntact ? "完好" : "破损"} · {record.sealNote}</span></div>
              <div><small>存放位置</small><span className={item.location !== record.location ? "mismatch" : ""}>{record.location}{item.location !== record.location && <em> 条目：{item.location}</em>}</span></div>
              <div><small>在库状态</small><span className={record.loanedTo ? "mismatch" : ""}>{record.loanedTo ? `外借中 → ${record.loanedTo}` : "在库"}</span></div>
              <div><small>保管人</small><span>{record.custodian}</span></div>
              <div><small>换袋回执</small><span className={record.awaitingReceipt ? "mismatch" : ""}>{record.awaitingReceipt ? "现场换袋，回执待补" : "无待办"}</span></div>
            </div>
            <div className="handover-log">
              <small>最近交接记录{!mismatch ? "（与条目一致）" : <em className="mismatch">（与条目登记不一致，需核对更新）</em>}</small>
              {record.handovers.slice(0, 3).map((event) => <div key={event.id} className="handover-item">
                <Tag size="small">{event.type}</Tag>
                <span>{new Date(event.time).toLocaleString("zh-CN", { hour12: false })} · {event.custodian} · {event.detail}{event.receiptNo ? ` · 回执 ${event.receiptNo}` : ""}</span>
              </div>)}
            </div>
            {clearance?.decision === "拦下" && <div className="block-reasons">
              {clearance.reasons.map((reason) => <Tag key={reason} color={reasonColor[reason]}>{reason}</Tag>)}
            </div>}
            {isClerk && <div className="custody-actions">
              {!record.loanedTo && <Button size="mini" onClick={() => openPrompt({ kind: "loan", record })}>原件外借</Button>}
              {record.loanedTo && <Button size="mini" status="success" onClick={() => dispatch(returnOriginal(item.id))}>外借归还入册</Button>}
              {!record.awaitingReceipt && <Button size="mini" status="warning" onClick={() => dispatch(replaceBag(item.id))}>现场换袋</Button>}
              {record.awaitingReceipt && <Button size="mini" type="primary" onClick={() => openPrompt({ kind: "receipt", record })}>回执登记</Button>}
              <Button size="mini" disabled={record.sealIntact} onClick={() => dispatch(markSealBroken(item.id))}>封条破损登记</Button>
              {!record.sealIntact && <Button size="mini" onClick={() => openPrompt({ kind: "reseal", record })}>重新封存换封</Button>}
              <Button size="mini" onClick={() => openPrompt({ kind: "transfer", record })}>库内移位</Button>
              {mismatch && <Button size="mini" type="outline" status="warning" onClick={() => dispatch(certifyEntry(item.id))}>核对一致并更新条目</Button>}
              {(clearance?.decision === "拦下" || item.status === "退回待复核") && <Button size="mini" type="primary" onClick={() => dispatch(recheckEvidence(item.id))}>按同批次重新核对</Button>}
            </div>}
          </>}
        </article>;
      })}
    </div>
    <Modal
      title={prompt ? promptMeta[prompt.kind].title : ""}
      visible={prompt !== null}
      onCancel={() => setPrompt(null)}
      onOk={submitPrompt}
      okText="登记"
    >
      {prompt && <Form layout="vertical">
        <Form.Item label={promptMeta[prompt.kind].label}>
          <Input value={promptValue} onChange={setPromptValue} placeholder={promptMeta[prompt.kind].placeholder} />
        </Form.Item>
      </Form>}
    </Modal>
  </Card>;
}

function CourtControl() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.court);
  const isAgent = state.session.role === "代理人";
  const [mode, setLocalMode] = useState<"控制" | "预览">("控制");
  const [objectionOpen, setObjectionOpen] = useState(false);
  const current = state.evidence.find((item) => item.id === state.session.currentEvidenceId);
  const currentClearance = current ? latestClearanceOf(state.clearances, current.id) : undefined;
  const pending = state.objections.filter((item) => item.status === "待裁定");
  const { control, handleSubmit, reset } = useForm<ObjectionForm>({ resolver: zodResolver(objectionSchema), defaultValues: { ground: "关联性异议", explanation: "" } });

  useEffect(() => { const timer = window.setInterval(() => dispatch(tick()), 1000); return () => window.clearInterval(timer); }, [dispatch]);
  const submitObjection = (values: ObjectionForm) => { if (!current) return; dispatch(addObjection({ evidenceId: current.id, ...values })); reset(); setObjectionOpen(false); Message.warning("异议已进入待裁定分支"); };

  const startShow = () => {
    dispatch(showEvidence());
    const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
    const record = item && state.custody.find((entry) => entry.evidenceId === item.id);
    if (item && record) {
      const reasons: BlockReason[] = [];
      if (record.loanedTo) reasons.push("外借未归还");
      if (!record.sealIntact) reasons.push("封条破损");
      if (record.awaitingReceipt) reasons.push("现场换袋无回执");
      if (item.sealNo !== record.sealNo) reasons.push("封条编号不一致");
      if (item.location !== record.location) reasons.push("存放位置不一致");
      if (item.handoverId !== record.lastHandoverId) reasons.push("交接记录不一致");
      if (reasons.length) Message.error(`上屏被拦：${reasons.join("、")}（封条编号、存放位置、最近交接记录需全部一致）`);
      else Message.success("原件与保管台账核对一致，放行上屏");
    }
  };

  const elapsed = current ? current.duration * 60 - state.session.timerSeconds : 0;

  return <div className="court-grid">
    <Card className="operator" title="证据操作台" extra={<Space><Tag color={state.online ? "green" : "red"}>{state.online ? "本地审计在线" : "离线恢复模式"}</Tag>{!isAgent && <Button size="small" onClick={() => dispatch(snapshot("手动存档"))}>保存快照</Button>}</Space>}>
      <div className="evidence-list">{state.evidence.map((item, index) => {
        const clearance = latestClearanceOf(state.clearances, item.id);
        return <article key={item.id} draggable={!isAgent} onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData("text/plain")); const items = [...state.evidence]; const [moved] = items.splice(from, 1); items.splice(index, 0, moved); dispatch(reorder(items)); }} className={current?.id === item.id ? "active" : ""}>
          <span>{index + 1}</span>
          <div>
            <b>{item.exhibitNo} · {item.title}</b>
            <small>{item.type} · {item.presenter} · {item.duration}分钟</small>
            <div className="gate-line"><GateTag clearance={clearance} size="small" />{item.status === "退回待复核" && <Tag size="small" color="orange">退回待复核</Tag>}</div>
          </div>
          <Tag color={item.status === "已展示" ? "green" : item.status === "展示中" ? "blue" : item.status === "退回待复核" ? "orange" : "gray"}>{item.status}</Tag>
          {!isAgent && <Button size="mini" onClick={() => dispatch(selectEvidence(item.id))}>选中</Button>}
        </article>;
      })}</div>
      {!isAgent && <div className="control-strip">
        <Button type="primary" onClick={startShow} disabled={!current || current.status === "展示中"}>{current?.status === "退回待复核" ? "复核后恢复上屏" : "推上公开屏（先对账）"}</Button>
        <Button onClick={() => dispatch(completeEvidence())} disabled={!current || current.status !== "展示中"}>完成并切换下一条</Button>
        <Button status="warning" onClick={() => setObjectionOpen(true)} disabled={!current}>提出异议</Button>
        <Button onClick={() => dispatch(toggleSensitive(current?.id ?? ""))} disabled={!current}>{current?.sensitive ? "恢复敏感内容" : "隐藏敏感内容"}</Button>
      </div>}
      {isAgent && <p className="agent-note">代理人视图：仅可查看证据是否放行及提出异议，保管台账与交接明细按权限隔离。</p>}
      {current?.status === "退回待复核" && <div className="review-banner">
        <Tag color="orange">退回待复核</Tag>
        <span>{current.exhibitNo} 上屏期间原件保管状态发生变化，当前展示已退回；已讲时长 {formatTime(elapsed)} 保留，复核放行后继续计入。</span>
      </div>}
      {!isAgent && currentClearance?.decision === "拦下" && <div className="review-banner blocked">
        <span>最近核对（批次 {currentClearance.batchId} 第 {currentClearance.attempt} 次）拦下：</span>
        {currentClearance.reasons.map((reason) => <Tag key={reason} color={reasonColor[reason]}>{reason}</Tag>)}
      </div>}
    </Card>
    <div className="side-stack">
      <Card title="公开屏预览" extra={!isAgent ? <Select size="small" value={mode} onChange={(value) => { setLocalMode(value as "控制" | "预览"); dispatch(setMode(value === "预览" ? "公开屏预览" : "庭审控制")); }} options={[{ value: "控制", label: "控制者视图" }, { value: "预览", label: "公开屏" }]} /> : <Tag size="small" color="gray">代理人视角仅见公开屏</Tag>} className="preview-card">
        <div className="public-screen">{(mode === "预览" || isAgent) ? (() => {
          // 公开屏：只呈现证据内容与是否可公开，不出现保管人姓名、封条说明、存放位置
          if (current?.status === "退回待复核") return <>
            <small>公开展示暂停</small>
            <h2>{current.exhibitNo}</h2>
            <h3>原件核对中，请稍候</h3>
            <p>该证据正在进行原件复核，已质证时长继续计入。</p>
            <footer>计时 {formatTime(state.session.timerSeconds)}（暂停） · {state.session.phase}</footer>
          </>;
          if (current?.status === "展示中") return <>
            <small>公开展示</small>
            <h2>{current.exhibitNo}</h2>
            <h3>{current.title}</h3>
            {current.sensitive ? <div className="redaction"><b>敏感内容已遮罩</b><p>该证据包含不适宜公开的信息，庭审结束后统一入卷。</p></div> : <p>{current.note}</p>}
            <footer>计时 {formatTime(state.session.timerSeconds)} · {state.session.phase}</footer>
          </>;
          return <>
            <small>公开展示</small>
            <h2>{current?.exhibitNo ?? "暂无证据"}</h2>
            <h3>{current ? "等待原件核对放行" : "庭审进行中"}</h3>
            <p>{current ? "书记员正在核对原件与卷宗保管台账，核对通过后上屏。" : ""}</p>
            <footer>{state.session.phase}</footer>
          </>;
        })() : <>
          <small>控制者私有视图</small>
          <h2>敏感内容可预览</h2>
          <p>{current?.sensitive ? "此证据将在公开屏遮罩客户名称，控制者可查看完整备注。" : "当前证据可完整公开。"}</p>
          <Tag color="red">操作端专属</Tag>
        </>}</div>
      </Card>
      <Card title="待审异议" extra={<Tag color="red">{pending.length}</Tag>}>{pending.map((item) => <div className="objection" key={item.id}><b>{item.ground}</b><p>{item.explanation}</p>{!isAgent && <Space><Button size="mini" status="success" onClick={() => dispatch(resolveObjection({ id: item.id, status: "支持" }))}>支持并跳过</Button><Button size="mini" onClick={() => dispatch(resolveObjection({ id: item.id, status: "驳回" }))}>驳回继续</Button></Space>}</div>)}{!pending.length && <p>当前没有待裁定异议。</p>}</Card>
      <CustodyLedger />
    </div>
    <Modal title="提出证据异议" visible={objectionOpen} onCancel={() => setObjectionOpen(false)} onOk={() => handleSubmit(submitObjection)()}><Form layout="vertical"><Form.Item label="异议类型"><Controller name="ground" control={control} render={({ field }) => <Select {...field} options={[{ value: "关联性异议", label: "关联性异议" }, { value: "真实性异议", label: "真实性异议" }, { value: "合法性异议", label: "合法性异议" }]} />} /></Form.Item><Form.Item label="异议说明"><Controller name="explanation" control={control} render={({ field }) => <Input.TextArea {...field} placeholder="说明异议依据和希望法庭裁定的事项" />} /></Form.Item></Form></Modal>
    {!isAgent && <Card title="庭审阶段" className="phase-card"><Radio.Group value={state.session.phase} onChange={(value) => dispatch(setPhase(value as SessionPhase))}><Radio value="开庭">开庭</Radio><Radio value="举证">举证</Radio><Radio value="质证">质证</Radio><Radio value="休庭">休庭</Radio><Radio value="结束">结束</Radio></Radio.Group></Card>}
  </div>;
}

function TimelinePage() {
  const state = useAppSelector((root) => root.court);
  const dispatch = useAppDispatch();
  const isAgent = state.session.role === "代理人";
  // 交接明细按角色隔离：代理人只能看到庭审类记录
  const entries = state.timeline.filter((item) => !isAgent || item.category !== "保管交接");
  return <div className="timeline-grid"><Card title={`庭审时间线${isAgent ? "（代理人视图：交接明细不可见）" : ""}`}><Timeline>{entries.map((item) => <Timeline.Item key={item.id} label={new Date(item.time).toLocaleTimeString("zh-CN", { hour12: false })}><b>{item.action}</b> <Tag>{item.actor}</Tag>{!isAgent && item.category === "保管交接" && <Tag color="gold">保管交接</Tag>}<p>{item.detail}</p></Timeline.Item>)}</Timeline></Card>
    {!isAgent && <Card title="本地恢复点"><p>每次手动存档或关键操作都会保留当前证据顺序、保管台账、放行结论和阶段。</p>{state.snapshots.map((item) => <div className="snapshot" key={item.id}><b>{item.label}</b><small>{new Date(item.time).toLocaleString("zh-CN")}</small><Button size="mini" onClick={() => dispatch(restore(item.id))}>恢复</Button></div>)}</Card>}
  </div>;
}

function EvidencePage() {
  const state = useAppSelector((root) => root.court);
  const dispatch = useAppDispatch();
  const isAgent = state.session.role === "代理人";
  return <Card title="证据目录与公开属性"><div className="catalog">{state.evidence.map((item) => <article key={item.id}><div><b>{item.exhibitNo} {item.title}</b><p>{item.note}</p>{!isAgent && <small>封条 {item.sealNo} · 存放 {item.location} · 交接点 {item.handoverId.slice(0, 8)}</small>}<div className="gate-line" style={{ marginTop: 6 }}><GateTag clearance={latestClearanceOf(state.clearances, item.id)} size="small" />{item.status === "退回待复核" && <Tag size="small" color="orange">退回待复核</Tag>}</div></div><Tag>{item.type}</Tag><div className="switch-line"><span>公开屏敏感遮罩</span><Switch checked={item.sensitive} disabled={isAgent} onChange={() => dispatch(toggleSensitive(item.id))} /></div></article>)}</div></Card>;
}

export default function App() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.court);
  const { data } = useGetCourtQuery();
  const [save] = useSaveCourtMutation();
  const { t, i18n } = useTranslation();
  useEffect(() => { if (data) dispatch(initialize(data)); }, [data, dispatch]);
  useEffect(() => {
    if (!state.initialized) return;
    const timer = window.setTimeout(() => void save({ evidence: state.evidence, custody: state.custody, clearances: state.clearances }), 300);
    return () => window.clearTimeout(timer);
  }, [state.evidence, state.custody, state.clearances, state.initialized, save]);
  const metrics = useMemo(() => ({ shown: state.evidence.filter((item) => item.status === "已展示").length, sensitive: state.evidence.filter((item) => item.sensitive).length, objections: state.objections.length }), [state]);
  return <div className="shell"><aside><div className="brand"><b>COURT</b><span>庭审控制</span></div><nav><NavLink to="/">{t("control")}</NavLink><NavLink to="/evidence">证据目录</NavLink><NavLink to="/timeline">{t("timeline")}</NavLink></nav><Button onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}>{i18n.language === "zh" ? "EN" : "中文"}</Button></aside><main><header><div><small>案件号 2026-民初-1084 · 全流程审计开启</small><h1>{t("title")}</h1></div><div className="top-tools"><label>当前角色</label><Select size="small" value={state.session.role} onChange={(value) => dispatch(setRole(value as Role))} options={[{ value: "书记员", label: "书记员（台账操作）" }, { value: "审判长", label: "审判长（全程只读）" }, { value: "代理人", label: "代理人（仅放行结论）" }]} /><label>本地恢复 <Switch checked={!state.online} onChange={(value) => dispatch(setOnline(!value))} /></label><Tag color={state.online ? "green" : "orange"}>{state.online ? "协作同步" : "离线操作"}</Tag></div></header><section className="metrics"><Card><Statistic title="证据总数" value={state.evidence.length} /></Card><Card><Statistic title="已完成质证" value={metrics.shown} /></Card><Card><Statistic title="敏感证据" value={metrics.sensitive} /></Card><Card><Statistic title="异议记录" value={metrics.objections} /></Card></section><Routes><Route path="/" element={<CourtControl />} /><Route path="/evidence" element={<EvidencePage />} /><Route path="/timeline" element={<TimelinePage />} /></Routes></main></div>;
}
