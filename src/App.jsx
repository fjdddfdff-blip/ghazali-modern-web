import { useEffect, useState } from "react";

function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const isInstalled = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    if (isInstalled || sessionStorage.getItem("ghazali-install-skipped") === "1") return undefined;

    const openPrompt = window.setTimeout(() => setVisible(true), 650);
    const captureInstall = (event) => {
      event.preventDefault();
      setInstallEvent(event);
      setVisible(true);
    };
    const hideAfterInstall = () => setVisible(false);

    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", hideAfterInstall);
    return () => {
      window.clearTimeout(openPrompt);
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", hideAfterInstall);
    };
  }, []);

  const install = async () => {
    if (!installEvent) {
      setShowHelp(true);
      return;
    }
    await installEvent.prompt();
    const result = await installEvent.userChoice;
    if (result.outcome === "accepted") setVisible(false);
    setInstallEvent(null);
  };

  const skip = () => {
    sessionStorage.setItem("ghazali-install-skipped", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="install-app-overlay no-print" role="dialog" aria-modal="true" aria-labelledby="install-app-title">
      <section className="install-app-card">
        <img src={`${import.meta.env.BASE_URL}icons/ghazali-icon.svg`} alt="" className="install-app-icon" />
        <div className="install-app-copy">
          <h2 id="install-app-title">ثبت تطبيق نظام الغزالي</h2>
          <p>يعمل بسرعة على الهاتف والحاسوب، ويحفظ عملك على الجهاز حتى بدون إنترنت.</p>
          {showHelp && (
            <p className="install-app-help">من قائمة المتصفح اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>
          )}
        </div>
        <div className="install-app-actions">
          <button type="button" className="btn install-app-confirm" onClick={install}>ثبت التطبيق</button>
          <button type="button" className="btn install-app-skip" onClick={skip}>تخطي</button>
        </div>
      </section>
    </div>
  );
}

function LoginScreen() {
  return (
    <section id="login-screen" aria-labelledby="login-title">
      <form
        className="login-box"
        onSubmit={(event) => {
          event.preventDefault();
          window.checkLogin?.();
        }}
      >
        <h1 id="login-title">أهلاً وسهلاً</h1>
        <label className="sr-only" htmlFor="login-user">اسم المستخدم</label>
        <input id="login-user" type="text" defaultValue="admin" placeholder="اسم المستخدم" autoComplete="username" />
        <label className="sr-only" htmlFor="login-pass">كلمة المرور</label>
        <input id="login-pass" type="password" defaultValue="1234" placeholder="كلمة المرور" autoComplete="current-password" />
        <button className="btn btn-primary w-full login-submit" type="submit">دخول للنظام</button>
      </form>
    </section>
  );
}

function SettingsLockModal() {
  const [showCode, setShowCode] = useState(false);

  const closeSecurityGate = () => {
    setShowCode(false);
    window.closeSettingsLock?.();
  };

  const submitSecurityCode = () => {
    if (window.verifySettingsPass?.()) setShowCode(false);
  };

  return (
    <div id="settings-lock-modal" className="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="settings-lock-title">
      <div className="modal-box settings-lock-box">
        <div className="security-orbits" aria-hidden="true"><i /><i /><i /></div>
        <div className="security-lock" aria-hidden="true">
          <span className="lock-shackle" />
          <span className="lock-body"><i /></span>
        </div>
        <h3 id="settings-lock-title">بوابة الإعدادات</h3>
        <p className="security-hint">اضغط على البصمة لإدخال رمز الحماية</p>

        <button
          type="button"
          className="fingerprint-button"
          aria-label="إظهار حقل رمز الحماية"
          aria-expanded={showCode}
          onClick={() => setShowCode(true)}
        >
          <span className="fingerprint-scan" aria-hidden="true" />
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M18 26c2-8 9-13 17-13 10 0 18 8 18 18 0 12-3 21-8 28" />
            <path d="M12 32c0-13 10-24 23-24 14 0 25 11 25 25 0 10-2 20-6 28" />
            <path d="M23 31c0-7 5-12 12-12s12 5 12 12c0 13-2 21-7 29" />
            <path d="M29 33c0-4 2-6 6-6s6 3 6 7c0 11-2 19-6 26" />
            <path d="M17 38c1 10-1 16-5 21" />
            <path d="M23 42c0 7-2 13-5 18" />
          </svg>
        </button>

        {showCode ? (
          <div className="security-code-panel">
            <label className="sr-only" htmlFor="settings-pass-input">رمز الحماية</label>
            <input
              type="password"
              id="settings-pass-input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength="4"
              placeholder="••••"
              autoComplete="off"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSecurityCode();
              }}
            />
            <div className="modal-actions">
              <button className="btn security-submit" onClick={submitSecurityCode}>فتح القفل</button>
              <button className="btn security-cancel" onClick={closeSecurityGate}>إلغاء</button>
            </div>
          </div>
        ) : (
          <button type="button" className="security-cancel-link" onClick={closeSecurityGate}>إلغاء</button>
        )}
      </div>
    </div>
  );
}

function WipeLockModal() {
  return (
    <div id="wipe-lock-modal" className="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="wipe-lock-title">
      <div className="modal-box">
        <h3 id="wipe-lock-title" className="danger-title">مسح كافة البيانات</h3>
        <p>أدخل الرمز السري للمسح النهائي:</p>
        <input type="password" id="wipe-pass-input" placeholder="الرمز السري" />
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => window.verifyWipeCode?.()}>مسح نهائي</button>
          <button className="btn btn-primary" onClick={() => window.closeWipeLock?.()}>تراجع</button>
        </div>
      </div>
    </div>
  );
}

function EditModal() {
  return (
    <div id="edit-modal" className="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-box">
        <h3 id="modal-title">تعديل</h3>
        <div id="modal-content" className="modal-content" />
        <div className="modal-actions">
          <button className="btn btn-success" onClick={() => window.saveModal?.()}>حفظ</button>
          <button className="btn btn-danger" onClick={() => window.closeModal?.()}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  return (
    <>
      <datalist id="global-contacts-list" />
      <button
        type="button"
        id="sidebar-toggle"
        className="sidebar-toggle no-print"
        aria-label="إظهار أو إخفاء التبويبات"
        aria-controls="sidebar"
        aria-expanded="true"
        onClick={() => window.toggleSidebar?.()}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <button
        type="button"
        id="sidebar-backdrop"
        className="sidebar-backdrop no-print"
        aria-label="إغلاق التبويبات"
        onClick={() => window.closeSidebar?.()}
      />
      <aside id="sidebar">
        <header className="sidebar-header">
          <h1 aria-label="نظام الغزالي">
            <span className="brand-full">نظام الغزالي</span>
            <span className="brand-short" aria-hidden="true">الغزالي</span>
          </h1>
          <div className="sidebar-tools no-print">
            <button
              type="button"
              id="sidebar-pin"
              className="sidebar-pin"
              aria-label="تثبيت الشريط الجانبي"
              aria-pressed="true"
              onClick={() => window.toggleSidebarPin?.()}
            >
              🔒 مثبت
            </button>
          </div>
        </header>
        <nav className="nav-menu" id="nav-menu" aria-label="التنقل الرئيسي" />
      </aside>
      <main id="main" tabIndex="-1" />
      <div id="global-footer-container" />
    </>
  );
}

export default function App() {
  return (
    <>
      <InstallAppPrompt />
      <LoginScreen />
      <SettingsLockModal />
      <WipeLockModal />
      <EditModal />
      <AppShell />
    </>
  );
}
