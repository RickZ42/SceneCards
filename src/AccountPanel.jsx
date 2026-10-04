import { useState } from "react";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import Eye from "lucide-react/dist/esm/icons/eye.js";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.js";
import LogOut from "lucide-react/dist/esm/icons/log-out.js";
import LogIn from "lucide-react/dist/esm/icons/log-in.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import UserPlus from "lucide-react/dist/esm/icons/user-plus.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { ACCOUNT_ENDPOINT, createAccountInvite } from "./accountSync.js";

export default function AccountPanel({ session, status, existingConnection, onSignIn, onExisting, onSignOut, onSync, onClose }) {
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error.message || "操作失败"); }
    finally { setBusy(false); }
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setMessage("已复制"); }
    catch { setMessage("无法复制，请使用输入框的复制菜单"); }
  }

  function secret(value, label) {
    return <label className="account-secret"><span>{label}</span><div>
      <input readOnly type={visible ? "text" : "password"} value={value} aria-label={label} autoComplete="off" />
      <button type="button" className="icon-button" title={visible ? "隐藏" : "显示"} aria-label={visible ? "隐藏" : "显示"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      <button type="button" className="icon-button" title={`复制${label}`} aria-label={`复制${label}`} onClick={() => copy(value)}><Copy size={18} /></button>
    </div></label>;
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="card-modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><h2 id="account-title">{session ? session.name : "登录私人词库"}</h2><button type="button" className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={20} /></button></div>
      {session ? <div className="account-content">
        <p className={`account-sync-status ${status.state}`} role="status">{status.message || "等待同步"}</p>
        {secret(session.code, "私人访问码")}
        <p className="account-note">访问码用于登录其他设备，也是你的 Shortcut 收件密钥。请私下保管。</p>
        <label><span>Shortcut 服务地址</span><input readOnly value={session.endpoint} aria-label="Shortcut 服务地址" /></label>
        <div className="account-actions">
          <button type="button" className="secondary-button" onClick={onSync} disabled={status.state === "syncing"}><RefreshCw size={18} />立即同步</button>
          <button type="button" className="secondary-button" onClick={onSignOut}><LogOut size={18} />退出账户</button>
        </div>
        {session.owner && <form className="account-invite" onSubmit={(event) => { event.preventDefault(); run(async () => { setInvite(await createAccountInvite(session, name)); setName(""); }); }}>
          <h3>邀请朋友</h3>
          <label><span>朋友的账户名称</span><input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
          <button className="primary-button" type="submit" disabled={busy}><UserPlus size={18} />{busy ? "正在创建" : "生成邀请码"}</button>
          {invite && <div className="invite-result">
            {secret(invite.code, "单次邀请码")}
            <p>{invite.name} · {new Date(invite.expiresAt).toLocaleDateString("zh-CN")} 到期</p>
            <button type="button" className="secondary-button" onClick={() => copy(`SceneCards 私人词库\n${window.location.origin}${window.location.pathname}\n邀请码：${invite.code}\n加入后，请保存你自己的私人访问码。`)}><Copy size={18} />复制邀请</button>
          </div>}
        </form>}
      </div> : <form className="account-content" onSubmit={(event) => { event.preventDefault(); run(() => onSignIn(code)); }}>
        <label><span>邀请码或私人访问码</span><input autoFocus required type={visible ? "text" : "password"} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <label className="account-show-code"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />显示访问码</label>
        <button className="primary-button" type="submit" disabled={busy}><LogIn size={18} />{busy ? "正在连接" : "登录"}</button>
        {existingConnection && <button type="button" className="secondary-button" disabled={busy} onClick={() => run(onExisting)}><LogIn size={18} />连接现有手机收件账户</button>}
      </form>}
      {message && <p className="account-message" role="alert">{message}</p>}
    </section>
  </div>;
}
