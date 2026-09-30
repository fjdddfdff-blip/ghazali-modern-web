/* Compatibility controller retained during the React migration to preserve IndexedDB, printing, and workflows. */
/**
         * محرك التخزين الفائق IndexedDB
         */
        const DB_NAME = "GhazaliSuperDB";
        const DB_VERSION = 1;
        let db;

        function openDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = e => {
                    const db = e.target.result;
                    db.createObjectStore("contacts", { keyPath: "id" });
                    const txStore = db.createObjectStore("transactions", { keyPath: "id" });
                    txStore.createIndex("date", "date", { unique: false });
                    txStore.createIndex("contactId", "contactId", { unique: false });
                    txStore.createIndex("secondaryId", "secondaryId", { unique: false });
                    db.createObjectStore("settings", { keyPath: "id" });
                };
                request.onsuccess = e => { db = e.target.result; resolve(); };
                request.onerror = e => reject(e);
            });
        }

        async function dbSave(storeName, data) {
            return new Promise(r => {
                const tx = db.transaction(storeName, "readwrite");
                tx.objectStore(storeName).put(data);
                tx.oncomplete = () => { scheduleCloudSync(); r(); };
            });
        }

        async function dbGetAll(storeName) {
            return new Promise(r => {
                const tx = db.transaction(storeName, "readonly");
                tx.objectStore(storeName).getAll().onsuccess = e => r(e.target.result);
            });
        }

        let state = {
            contacts:[], transactions:[], invoiceItems:[], activeTab: 'invoice',
            settings: { id: 1, buyerFee: 2.5, sellerDisc: 0.5, p1: 2.5, p2: 0, user: 'admin', pass: '1234' }
        };
        let dailyInvoiceDate = new Date().toISOString().split('T')[0];
        let dailySearchTerm = "";
        let dailyPriceSearchTerm = "";
        let voucherHistoryDate = new Date().toISOString().split('T')[0];
        let settLocked = true;

        async function load() {
            const contacts = await dbGetAll("contacts");
            const settings = await dbGetAll("settings");
            const txs = await dbGetAll("transactions");
            state.contacts = contacts || [];
            state.transactions = txs || [];
            if(settings.length > 0) state.settings = settings[0];
            else await dbSave("settings", state.settings);

            const cloud = window.ghazaliCloud;
            if(!cloud?.available) return;
            try {
                cloud.cancelPending?.();
                const previousSyncKey = state.settings.cloudSyncKey || '';
                const personalSyncKey = cloud.personalSyncKey;
                const adoptingPersonalCloud = previousSyncKey !== personalSyncKey;
                state.settings.cloudSyncKey = personalSyncKey;
                await writeLocalOnly("settings", state.settings);
                await cloud.initialize(personalSyncKey);
                const remote = await cloud.pull();
                const localSyncAt = Number(state.settings.cloudSyncAt) || 0;
                const localSize = state.contacts.length + state.transactions.length;
                const remoteSize = remote?.data
                    ? (remote.data.contacts?.length || 0) + (remote.data.transactions?.length || 0)
                    : 0;
                const shouldUseRemote = remote?.data && (
                    (adoptingPersonalCloud && remoteSize > 0 && localSize === 0)
                    || (remote.updatedAt > localSyncAt && !(adoptingPersonalCloud && localSize > 0 && remoteSize === 0))
                );
                if(shouldUseRemote) {
                    await replaceLocalSnapshot(remote.data, remote.updatedAt, personalSyncKey);
                } else {
                    const updatedAt = await cloud.push(cloudSnapshot());
                    if(updatedAt) {
                        state.settings.cloudSyncAt = updatedAt;
                        await writeLocalOnly("settings", state.settings);
                    }
                }
            } catch(err) {
                console.warn('تعذر جلب المزامنة السحابية؛ تم فتح النسخة المحلية.', err);
            }
        }

        function cloudSnapshot() {
            return {
                contacts: state.contacts,
                transactions: state.transactions,
                settings: state.settings,
            };
        }

        function scheduleCloudSync() {
            window.ghazaliCloud?.schedule?.(cloudSnapshot);
        }

        async function writeLocalOnly(storeName, data) {
            return new Promise((resolve,reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).put(data);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }

        async function replaceLocalSnapshot(snapshot, updatedAt, syncKey = state.settings.cloudSyncKey) {
            if(!snapshot || !Array.isArray(snapshot.contacts) || !Array.isArray(snapshot.transactions) || !snapshot.settings) return;
            const nextSettings = { ...snapshot.settings, cloudSyncKey:syncKey, cloudSyncAt:updatedAt };
            await new Promise((resolve,reject) => {
                const tx = db.transaction(['contacts','transactions','settings'], 'readwrite');
                const contactsStore = tx.objectStore('contacts');
                const transactionsStore = tx.objectStore('transactions');
                const settingsStore = tx.objectStore('settings');
                contactsStore.clear(); transactionsStore.clear(); settingsStore.clear();
                snapshot.contacts.forEach(item => contactsStore.put(item));
                snapshot.transactions.forEach(item => transactionsStore.put(item));
                settingsStore.put(nextSettings);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
            state.contacts = snapshot.contacts;
            state.transactions = snapshot.transactions;
            state.settings = nextSettings;
        }

        window.addEventListener('ghazali-cloud-synced', async event => {
            if(!state.settings || !event.detail?.updatedAt) return;
            state.settings.cloudSyncAt = event.detail.updatedAt;
            try { await writeLocalOnly('settings', state.settings); } catch(err) { console.warn(err); }
        });

        function getPrintDate() { return new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); }

        function shareViaWhatsApp(title, rootId = 'main') {
            const root = document.getElementById(rootId);
            if (!root) return alert('تعذر تجهيز محتوى المشاركة');

            const lines = [`*${title}*`, `التاريخ: ${getPrintDate()}`];
            const tables = Array.from(root.querySelectorAll('table'));

            tables.forEach((table, tableIndex) => {
                const rows = Array.from(table.querySelectorAll('tr')).slice(0, 45);
                const tableLines = rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('th, td'))
                        .filter(cell => !cell.classList.contains('no-print'))
                        .map(cell => cell.innerText.replace(/\s+/g, ' ').trim())
                        .filter(Boolean);
                    return cells.join(' | ');
                }).filter(Boolean);
                if (tableLines.length) {
                    if (tables.length > 1) lines.push(`— جدول ${tableIndex + 1} —`);
                    lines.push(...tableLines);
                }
            });

            const fieldLines = Array.from(root.querySelectorAll('input:not([type="password"]):not([type="file"]), textarea'))
                .filter(field => field.value && field.offsetParent !== null)
                .slice(0, 12)
                .map(field => {
                    const label = field.id ? root.querySelector(`label[for="${field.id}"]`) : null;
                    const nearbyLabel = label || field.closest('div')?.querySelector('label');
                    return `${nearbyLabel?.innerText?.trim() || field.placeholder || 'القيمة'}: ${field.value}`;
                });
            if (fieldLines.length) lines.push('— البيانات —', ...fieldLines);

            const summaries = Array.from(root.querySelectorAll('.stat-box, .voucher-total-box, .daily-total-field'))
                .map(item => item.innerText.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (summaries.length) lines.push('— المجاميع —', ...new Set(summaries));

            const message = lines.join('\n').slice(0, 6000);
            window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
        }

        function autoCompleteName(e) {
            if (e.inputType && e.inputType.startsWith('delete')) return; 
            const val = e.target.value;
            if (val.length < 1) return; 
            const match = state.contacts.find(c => c.name.startsWith(val));
            if (match && match.name !== val) {
                const len = val.length; 
                e.target.value = match.name; 
                e.target.setSelectionRange(len, match.name.length); 
            }
        }

        async function checkLogin() {
            await openDB();
            await load();
            if(document.getElementById('login-user').value === state.settings.user && document.getElementById('login-pass').value === state.settings.pass) {
                document.getElementById('login-screen').classList.add('hidden'); init();
            } else alert('بيانات الدخول خاطئة');
        }

        const sidebarMedia = window.matchMedia('(max-width: 760px)');
        let sidebarIsMobile = sidebarMedia.matches;
        let sidebarIsOpen = !sidebarIsMobile;
        let sidebarIsPinned = true;
        let pendingPageTimer = 0;
        let contactsDatalistKey = '';

        try { sidebarIsPinned = localStorage.getItem('ghazali-sidebar-pinned') !== 'false'; } catch (_) {}

        function syncSidebarUI() {
            const body = document.body;
            const toggle = document.getElementById('sidebar-toggle');
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            const pin = document.getElementById('sidebar-pin');
            if (!body) return;
            body.classList.toggle('sidebar-mobile', sidebarIsMobile);
            body.classList.toggle('sidebar-open', !sidebarIsMobile && sidebarIsOpen);
            body.classList.toggle('sidebar-collapsed', !sidebarIsMobile && !sidebarIsOpen);
            body.classList.toggle('sidebar-pinned', !sidebarIsMobile && sidebarIsPinned);
            sidebar?.classList.toggle('is-open', sidebarIsMobile && sidebarIsOpen);
            backdrop?.classList.toggle('is-open', sidebarIsMobile && sidebarIsOpen);
            if (toggle) {
                toggle.classList.toggle('is-open', sidebarIsMobile && sidebarIsOpen);
                toggle.setAttribute('aria-expanded', String(sidebarIsOpen));
                toggle.setAttribute('aria-label', sidebarIsOpen ? 'إخفاء التبويبات' : 'إظهار التبويبات');
                toggle.title = sidebarIsOpen ? 'إخفاء التبويبات' : 'إظهار التبويبات';
                toggle.innerHTML = `<span aria-hidden="true">${sidebarIsOpen ? '×' : '☰'}</span>`;
            }
            if (pin) {
                pin.setAttribute('aria-pressed', String(sidebarIsPinned));
                pin.setAttribute('aria-label', sidebarIsPinned ? 'إلغاء تثبيت الشريط الجانبي' : 'تثبيت الشريط الجانبي');
                pin.title = sidebarIsPinned ? 'مثبت: يبقى الشريط ظاهرًا' : 'غير مثبت: يختفي بعد اختيار التبويب';
                pin.textContent = sidebarIsPinned ? '🔒 مثبت' : '🔓 تلقائي';
            }
        }

        function initSidebarControls() {
            sidebarIsMobile = sidebarMedia.matches;
            sidebarIsOpen = sidebarIsMobile ? false : sidebarIsPinned;
            syncSidebarUI();
            const onSidebarModeChange = (event) => {
                sidebarIsMobile = event.matches;
                sidebarIsOpen = sidebarIsMobile ? false : sidebarIsPinned;
                syncSidebarUI();
            };
            if (sidebarMedia.addEventListener) sidebarMedia.addEventListener('change', onSidebarModeChange);
            else sidebarMedia.addListener(onSidebarModeChange);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && sidebarIsOpen && sidebarIsMobile) window.closeSidebar();
            });
        }

        window.toggleSidebar = function() {
            sidebarIsOpen = !sidebarIsOpen;
            syncSidebarUI();
        };
        window.closeSidebar = function() {
            sidebarIsOpen = false;
            syncSidebarUI();
        };
        window.toggleSidebarPin = function() {
            if (sidebarIsMobile) return;
            sidebarIsPinned = !sidebarIsPinned;
            if (sidebarIsPinned) sidebarIsOpen = true;
            try { localStorage.setItem('ghazali-sidebar-pinned', String(sidebarIsPinned)); } catch (_) {}
            syncSidebarUI();
        };

        function closeSidebarAfterNavigation() {
            if (sidebarIsMobile || !sidebarIsPinned) {
                sidebarIsOpen = false;
                syncSidebarUI();
            }
        }

        function schedulePageRender() {
            if (pendingPageTimer) clearTimeout(pendingPageTimer);
            pendingPageTimer = setTimeout(() => {
                pendingPageTimer = 0;
                renderPage();
            }, 0);
        }

        function focusPrimaryField(id) {
            if (sidebarIsMobile || window.matchMedia('(pointer: coarse)').matches) return;
            setTimeout(() => document.getElementById(id)?.focus(), 50);
        }

        function init() { initSidebarControls(); renderSidebar(); navigate('dashboard'); }
        function updateDatalist() {
            const list = document.getElementById('global-contacts-list');
            if (!list) return;
            const nextKey = JSON.stringify(state.contacts.map(c => [c.id, c.name]));
            if (nextKey === contactsDatalistKey) return;
            const indexedContacts = [...state.contacts].sort((a, b) => a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' }));
            list.innerHTML = indexedContacts.map(c => `<option value="${c.name}">`).join('');
            contactsDatalistKey = nextKey;
        }

        function renderSidebar() {
            const menu =[
                { id: 'dashboard', label: 'الصفحة الرئيسية', short: 'الرئيس', icon: '⌂' },
                { id: 'invoice', label: 'فاتورة مبيعات', short: 'بيع', icon: '📝' },
                { id: 'daily_invoices', label: 'الفواتير اليومية', short: 'يومية', icon: '📅' },
                { id: 'receipt', label: 'سنــد قبض', short: 'قبض', icon: '📥' },
                { id: 'payment', label: 'سنـــد دفع', short: 'دفع', icon: '📤' },
                { id: 'contacts', label: 'إدارة الأسماء', short: 'أسماء', icon: '👥' },
                { id: 'statement', label: 'كشف حساب', short: 'كشف', icon: '📜' },
                { id: 'balances', label: 'الأرصــــــدة', short: 'رصيد', icon: '💰' },
                { id: 'reports', label: 'التقــــــــــارير', short: 'تقارير', icon: '📊' },
                { id: 'settings', label: 'إعدادات النظام', short: 'ضبط', icon: '⚙️' }
            ];
            const nav = document.getElementById('nav-menu');
            if (!nav.querySelector('.nav-item')) {
                nav.innerHTML = menu.map(i => `<button type="button" class="nav-item" data-tab="${i.id}" data-short="${i.short}" onclick="navigate('${i.id}')" aria-label="${i.label}" title="${i.label}"><span aria-hidden="true">${i.icon}</span><span>${i.label}</span></button>`).join('');
            }
            nav.querySelectorAll('.nav-item').forEach(button => {
                const isActive = button.dataset.tab === state.activeTab;
                button.classList.toggle('active', isActive);
                if (isActive) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            });
        }

        function navigate(tab) {
            if (tab === 'settings') {
                if (pendingPageTimer) {
                    clearTimeout(pendingPageTimer);
                    pendingPageTimer = 0;
                }
                document.getElementById('settings-lock-modal').classList.remove('hidden');
                closeSidebarAfterNavigation();
                return;
            }
            const isSameTab = state.activeTab === tab;
            state.activeTab = tab;
            renderSidebar();
            closeSidebarAfterNavigation();
            if (!isSameTab) schedulePageRender();
        }

        function verifySettingsPass() {
            const input = document.getElementById('settings-pass-input');
            if (input?.value === '1001') {
                document.getElementById('settings-lock-modal').classList.add('hidden'); input.value = '';
                state.activeTab = 'settings'; renderSidebar(); renderPage();
                closeSidebarAfterNavigation();
                return true;
            }
            alert('رمز الحماية غير صحيح');
            if (input) { input.value = ''; input.focus(); }
            return false;
        }
        function closeSettingsLock() { document.getElementById('settings-lock-modal').classList.add('hidden'); }

        function updateGlobalFooter() {
            if(state.activeTab === 'reports' || state.activeTab === 'daily_invoices' || state.activeTab === 'dashboard') return;
            const deb = state.contacts.reduce((a,b)=> a + (b.balance > 0 ? b.balance : 0), 0);
            const cre = state.contacts.reduce((a,b)=> a + (b.balance < 0 ? Math.abs(b.balance) : 0), 0);
            const net = deb - cre;
            const remainingBox = state.activeTab === 'balances' ? `<div class="stat-box">الباقي: <b>${(net - 100000).toFixed(2)}</b></div>` : '';
            document.getElementById('global-footer-container').innerHTML = `<div class="global-footer no-print"><div class="stat-box">لنا: <b>${deb.toFixed(2)}</b></div><div class="stat-box">علينا: <b>${cre.toFixed(2)}</b></div><div class="stat-box">الصافي: <b>${net.toFixed(2)}</b></div>${remainingBox}</div>`;
        }

        function renderPage() {
            document.body.classList.remove('voucher-page','daily-invoices-page','dashboard-page');
            const m = document.getElementById('main'); m.innerHTML = ''; m.scrollTop = 0;
            document.getElementById('global-footer-container').innerHTML = '';
            document.querySelectorAll('.modal-overlay').forEach(el => { if(!el.id.includes('lock')) el.classList.add('hidden'); });
            updateDatalist();
            switch(state.activeTab) {
                case 'dashboard': document.body.classList.add('dashboard-page'); renderDashboard(m); break;
                case 'invoice': renderInvoice(m); break;
                case 'daily_invoices': document.body.classList.add('daily-invoices-page'); renderDailyInvoices(m); break;
                case 'receipt': renderVoucher(m, 'قبض'); break;
                case 'payment': renderVoucher(m, 'دفع'); break;
                case 'contacts': renderContacts(m); break;
                case 'statement': renderStatement(m); break;
                case 'balances': renderBalances(m); break;
                case 'reports': renderReports(m); break;
                case 'settings': renderSettings(m); break;
            }
            updateGlobalFooter();
        }

        function navNext(e, nextId) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById(nextId).focus(); } }

        function transactionActionButtons(id) {
            const safeId = JSON.stringify(id);
            return `<div class="row-actions no-print"><button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation();openEdit(${safeId}, 'tx')" title="تعديل المعاملة" aria-label="تعديل المعاملة">✏️</button><button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation();delTx(${safeId})" title="حذف المعاملة" aria-label="حذف المعاملة">🗑️</button></div>`;
        }

        function contactActionButtons(id) {
            const safeId = JSON.stringify(id);
            return `<div class="row-actions no-print"><button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation();openEdit(${safeId}, 'contact')" title="تعديل الاسم" aria-label="تعديل الاسم">✏️</button><button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation();delC(${safeId})" title="حذف الاسم" aria-label="حذف الاسم">🗑️</button></div>`;
        }

        function renderDashboard(m) {
            const invoices = state.transactions.filter(t=>t.type==='فاتورة').sort((a,b)=>new Date(b.date)-new Date(a.date));
            const contactsMap={}; state.contacts.forEach(c=>contactsMap[c.id]=c.name);
            const fiscalYear = escapeHTML(state.settings?.fiscalYear || new Date().getFullYear());
            const today=new Date().toLocaleDateString('en-CA');
            let todaySales=0, totalQty=0;
            const monthlyTotals = new Map();
            invoices.forEach(t => {
                const amount = Number(t.amount||0);
                const date = String(t.date);
                const monthKey = date.slice(0,7);
                if(date.startsWith(today)) todaySales += amount;
                totalQty += Number(t.details?.tQty||0);
                monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey)||0) + amount);
            });
            const deb=state.contacts.reduce((a,c)=>a+(Number(c.balance)>0?Number(c.balance):0),0);
            const rows=invoices.slice(0,5);
            const now=new Date();
            const months=[]; for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1); const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); const val=monthlyTotals.get(key)||0; months.push({name:d.toLocaleDateString('ar-IQ',{month:'short'}),val});}
            const max=Math.max(...months.map(x=>x.val),1);
            m.innerHTML=`<div class="dashboard-shell">
              <div class="dash-top"><div class="dash-welcome">مرحباً بك في نظام الغزالي للمحاسبة والمخزون <span style="display:inline-block; margin-right:8px; padding:3px 10px; border-radius:999px; background:#eceefe; color:#343170; font-size:.76rem;">السنة المالية: ${fiscalYear}</span></div><div class="dash-date">◷ &nbsp; ${now.toLocaleDateString('en-CA')}<br>${now.toLocaleTimeString('ar-IQ',{hour:'2-digit',minute:'2-digit'})}</div></div>
              <div class="dash-cards">
                <div class="dash-card"><div class="dash-card-icon">◉</div><div class="dash-card-text"><div class="dash-card-label">إجمالي الأرصدة لنا</div><div class="dash-card-value">${deb.toLocaleString()}</div><div class="dash-card-line"></div></div></div>
                <div class="dash-card"><div class="dash-card-icon">🛒</div><div class="dash-card-text"><div class="dash-card-label">مبيعات اليوم</div><div class="dash-card-value">${todaySales.toLocaleString()}</div><div class="dash-card-line"></div></div></div>
                <div class="dash-card"><div class="dash-card-icon">◆</div><div class="dash-card-text"><div class="dash-card-label">إجمالي العدد</div><div class="dash-card-value">${totalQty.toLocaleString()}</div><div class="dash-card-line"></div></div></div>
                <div class="dash-card"><div class="dash-card-icon">👥</div><div class="dash-card-text"><div class="dash-card-label">إجمالي العملاء</div><div class="dash-card-value">${state.contacts.length.toLocaleString()}</div><div class="dash-card-line"></div></div></div>
              </div>
              <div class="dash-grid">
                <div>
                  <div class="dash-panel"><div class="dash-panel-title"><span>▣ &nbsp; آخر الفواتير</span><span>▤</span></div><div class="dash-panel-body"><table class="dash-table"><thead><tr><th>#</th><th>المشتري</th><th>البائع</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th class="no-print">إجراء</th></tr></thead><tbody>${rows.length?rows.map((t,i)=>`<tr><td>${i+1}</td><td>${contactsMap[t.contactId]||'—'}</td><td>${contactsMap[t.secondaryId]||'—'}</td><td>${String(t.date).slice(0,10)}</td><td>${Number(t.amount||0).toLocaleString()}</td><td><span class="dash-status">محفوظة</span></td><td class="no-print">${transactionActionButtons(t.id)}</td></tr>`).join(''):`<tr><td colspan="7">لا توجد فواتير بعد</td></tr>`}</tbody></table></div></div>
                  <div class="dash-panel"><div class="dash-panel-title"><span>▥ &nbsp; مخطط المبيعات الشهرية</span><span>▥</span></div><div class="dash-panel-body"><div class="dash-chart">${months.map(x=>`<div class="dash-bar" style="height:${Math.max(8,Math.round((x.val/max)*100))}%"><span>${x.name}</span></div>`).join('')}</div></div></div>
                </div>
                <div class="dash-panel"><div class="dash-panel-title"><span>⚡ &nbsp; أزرار سريعة</span></div><div class="dash-panel-body"><div class="quick-grid">
                  <button class="quick-btn q1" onclick="navigate('invoice')"><b>🛒</b>فاتورة جديدة</button><button class="quick-btn q2" onclick="navigate('daily_invoices')"><b>🧺</b>الفواتير اليومية</button>
                  <button class="quick-btn q3" onclick="navigate('receipt')"><b>▣</b>سند قبض</button><button class="quick-btn q4" onclick="navigate('contacts')"><b>👥</b>إضافة عميل</button>
                  <button class="quick-btn q5" onclick="navigate('reports')"><b>▥</b>عرض التقارير</button><button class="quick-btn q6" onclick="navigate('settings')"><b>⚙</b>الإعدادات</button>
                </div></div></div>
              </div>
            </div>`;
        }

        function renderInvoice(m) {
            m.innerHTML = `<div class="page-header"><div class="page-title">فاتورة مبيعات</div><div class="no-print page-actions" style="display:flex;align-items:center;gap:8px;font-size:1rem;font-weight:900;color:#0f172a;">التاريخ <input type="date" id="i-date" value="${new Date().toLocaleDateString('en-CA')}" style="width:155px;margin:0;"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨️ طباعة</button><button class="btn btn-success btn-sm whatsapp-btn" onclick="shareViaWhatsApp('فاتورة مبيعات')">🟢 واتساب</button></div></div>
                <div class="card no-print"><div class="invoice-entry-grid" style="display:grid; grid-template-columns: 70px 90px 1fr 1fr auto auto; gap:8px; align-items:end;">
                    <div><label>العدد</label><input type="number" id="i-qty" onkeydown="navNext(event, 'i-price')"></div>
                    <div><label>السعر</label><input type="number" id="i-price" onkeydown="navNext(event, 'i-buyer')"></div>
                    <div><label>المشتري</label><input list="global-contacts-list" id="i-buyer" oninput="autoCompleteName(event)" onkeydown="navNext(event, 'i-seller')"></div>
                    <div><label>البائع</label><input list="global-contacts-list" id="i-seller" oninput="autoCompleteName(event)" onkeydown="navNext(event, 'btn-add')"></div>
                    <button id="btn-add" class="btn btn-primary" onclick="addII()">إضافة</button><button class="btn btn-success" onclick="saveInv()">حفظ الفاتورة</button>
                </div></div>
                <div class="card" style="padding:0; overflow:hidden;"><div class="print-only-header"><h2>فاتورة مبيعات</h2><span class="date">التاريخ: ${getPrintDate()}</span></div><table><thead><tr><th>العدد</th><th>السعر</th><th>المشتري</th><th>البائع</th><th>الإجمالي</th><th>إجراء</th></tr></thead><tbody id="i-body"></tbody></table></div>`;
            renderITable(); focusPrimaryField('i-qty');
        }
        function addII() {
            const q = parseFloat(document.getElementById('i-qty').value), p = parseFloat(document.getElementById('i-price').value), bn = document.getElementById('i-buyer').value, sn = document.getElementById('i-seller').value;
            if(q && p && bn && sn) { 
                state.invoiceItems.push({qty:q, price:p, total:q*p, buyer: bn.trim(), seller: sn.trim()}); renderITable(); 
                document.getElementById('i-qty').value=''; document.getElementById('i-price').value=''; document.getElementById('i-buyer').value=''; document.getElementById('i-seller').value=''; 
                document.getElementById('i-qty').focus(); 
            }
        }
        function editII(index) {
            const item = state.invoiceItems[index]; document.getElementById('i-qty').value = item.qty; document.getElementById('i-price').value = item.price;
            document.getElementById('i-buyer').value = item.buyer; document.getElementById('i-seller').value = item.seller;
            state.invoiceItems.splice(index, 1); renderITable(); document.getElementById('i-qty').focus();
        }
        function renderITable() {
            document.getElementById('i-body').innerHTML = state.invoiceItems.map((it, i) => `<tr><td>${it.qty}</td><td>${it.price.toFixed(2)}</td><td>${it.buyer}</td><td>${it.seller}</td><td>${it.total.toFixed(2)}</td><td><div class="row-actions"><button type="button" class="btn btn-primary btn-sm" onclick="editII(${i})" title="تعديل السطر" aria-label="تعديل السطر">✏️</button><button type="button" class="btn btn-danger btn-sm" onclick="state.invoiceItems.splice(${i},1);renderITable()" title="حذف السطر" aria-label="حذف السطر">🗑️</button></div></td></tr>`).join('');
        }
        async function saveInv() {
            if(state.invoiceItems.length===0) return;
            for(let item of state.invoiceItems) {
                const b = await findOrCreateC(item.buyer), s = await findOrCreateC(item.seller);
                const sett = state.settings;
                const raw = item.total, bFee = item.qty * sett.buyerFee, finalB = raw + bFee;
                const sDisc = item.qty * sett.sellerDisc, d1 = raw * (sett.p1/100), d2 = (raw-d1)*(sett.p2/100), finalS = raw - sDisc - d1 - d2;
                b.balance += finalB; s.balance -= finalS;
                const pickedInvoiceDate = document.getElementById('i-date')?.value || new Date().toLocaleDateString('en-CA');
                const nowTime = new Date().toTimeString().slice(0,8);
                const newTx = { id: Date.now()+Math.random(), date: pickedInvoiceDate + 'T' + nowTime, type: 'فاتورة', contactId: b.id, secondaryId: s.id, amount: finalB, details: { tQty: item.qty, raw, sellerCredit: finalS, bFee, sTotalDisc: raw - finalS } };
                state.transactions.push(newTx);
                await dbSave("transactions", newTx);
                await dbSave("contacts", b);
                await dbSave("contacts", s);
            }
            state.invoiceItems =[]; navigate('invoice');
        }

        function renderDailyInvoices(m) {
            const cMap = {}; state.contacts.forEach(c => cMap[c.id] = c.name);
            const filtered = state.transactions.filter(t => {
                const isMatchDate = t.type === 'فاتورة' && t.date.startsWith(dailyInvoiceDate);
                if (!isMatchDate) return false;
                const buyerName = (cMap[t.contactId] || "").toLowerCase();
                const sellerName = (cMap[t.secondaryId] || "").toLowerCase();
                const nameOk = !dailySearchTerm || buyerName.includes(dailySearchTerm.toLowerCase()) || sellerName.includes(dailySearchTerm.toLowerCase());
                const unitPrice = Number(t.details?.tQty) ? Number(t.details?.raw || 0) / Number(t.details.tQty) : 0;
                const priceOk = !dailyPriceSearchTerm || String(unitPrice).includes(dailyPriceSearchTerm);
                return nameOk && priceOk;
            });
            
            let tQ=0, tR=0, tB=0, tS=0, tAllDisc=0;
            filtered.forEach(t => {
                tQ += (t.details.tQty || 0);
                tR += (t.details.raw || 0);
                tB += (t.amount || 0);
                tS += (t.details.sellerCredit || 0);
                tAllDisc += ((t.details.sTotalDisc || 0) + (t.details.bFee || 0));
            });

            m.innerHTML = `<div class="page-header no-print">
                    <div class="page-title">الفواتير اليومية</div>
                    <div class="daily-filter-bar" style="display:flex; gap:10px; align-items:center;">
                        <input type="text" id="daily-search-input" dir="rtl" value="${dailySearchTerm}" placeholder="بحث بالاسم..." oninput="dailySearchTerm=this.value;renderDailyInvoices(document.getElementById('main'));requestAnimationFrame(()=>{const e=document.getElementById('daily-search-input');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}})" style="width:180px; margin:0; direction:rtl; text-align:right; unicode-bidi:plaintext;">
                        <input type="number" id="daily-price-search" inputmode="decimal" value="${dailyPriceSearchTerm}" placeholder="بحث بالسعر..." oninput="dailyPriceSearchTerm=this.value;renderDailyInvoices(document.getElementById('main'));requestAnimationFrame(()=>{const e=document.getElementById('daily-price-search');if(e){e.focus();}})" style="width:145px; margin:0; direction:ltr; text-align:center;">
                        <input type="date" value="${dailyInvoiceDate}" onchange="dailyInvoiceDate=this.value;renderDailyInvoices(document.getElementById('main'))" style="width:140px; margin:0;">
                        <button class="btn btn-primary btn-sm" onclick="window.print()">🖨️ طباعة</button>
                        <button class="btn btn-success btn-sm whatsapp-btn" onclick="shareViaWhatsApp('الفواتير اليومية')">🟢 واتساب</button>
                    </div>
                </div>
                <div class="card" style="padding:0; overflow:hidden;"><div class="print-only-header"><h2>الفواتير اليومية</h2><span class="date">التاريخ: ${getPrintDate()}</span></div>
                <table><thead><tr><th>العدد</th><th>السعر</th><th>المشتري</th><th>البائع</th><th>الإجمالي</th><th class="no-print">إجراء</th></tr></thead>
                <tbody>${filtered.map(t => `<tr><td>${t.details.tQty}</td><td>${(t.details.raw/t.details.tQty).toFixed(2)}</td><td>${cMap[t.contactId]||'؟'}</td><td>${cMap[t.secondaryId]||'؟'}</td><td style="font-weight:bold">${t.details.raw.toFixed(2)}</td><td class="no-print">${transactionActionButtons(t.id)}</td></tr>`).join('')}</tbody>
                <tfoot style="background:yellow !important; font-weight:900;">
                    <tr style="background:yellow !important; color:#000;">
                        <td><div class="daily-total-field">العدد: ${tQ}</div></td>
                        <td><div class="daily-total-field">الخصم: ${tAllDisc.toFixed(2)}</div></td>
                        <td><div class="daily-total-field">المشتري: ${tB.toFixed(2)}</div></td>
                        <td><div class="daily-total-field">البائـــــــع: ${tS.toFixed(2)}</div></td>
                        <td><div class="daily-total-field">الإجمالي: ${tR.toFixed(2)}</div></td>
                        <td class="no-print"><div class="daily-total-field">المجموع</div></td>
                    </tr>
                </tfoot>
                </table></div>`;
        }

        function renderVoucher(m, type) {
            const title = `سند ${type}`;
            document.body.classList.add('voucher-page');
            m.innerHTML = `
            <div class="page-header no-print"><div class="page-title">${title}</div></div>
            <div class="voucher-workspace" style="display:grid; grid-template-columns:minmax(0,2fr) minmax(360px,1fr); grid-template-rows:minmax(0,1fr) 58px; gap:14px; height:calc(100vh - 78px); direction:ltr; overflow:hidden;">
                <div class="card" style="padding:0; overflow:hidden; margin:0; display:flex; flex-direction:column; direction:rtl; min-height:0;">
                    <div class="no-print" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-bottom:1px solid #94a3b8; background:#fff;">
                        <label style="margin:0; white-space:nowrap; font-size:1rem;">البحث</label>
                        <input id="v-search" type="text" placeholder="بحث بالاسم أو الرقم..." oninput="drawVoucherList('${type}')" style="margin:0; flex:1;">
                    </div>
                    <div style="flex:1; overflow-y:auto; overflow-x:hidden; background:#fff; min-height:0;">
                        <table style="direction:rtl;">
                            <thead><tr><th class="v-print-hide" style="width:90px;">رقم</th><th class="v-from-head">الاسم</th><th class="v-to-head">الاسم</th><th class="v-print-hide" style="width:150px;">تاريخ</th><th style="width:170px;">المبلغ</th><th class="no-print action-column">إجراء</th></tr></thead>
                            <tbody id="v-history-body"></tbody>
                        </table>
                    </div>
                </div>

                <div class="card voucher-form-side" style="margin:0; padding:14px; direction:rtl; overflow:hidden; min-height:0;">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                            <label style="width:70px; margin:0;">التاريخ</label>
                            <input type="date" id="v-date" value="${voucherHistoryDate}" onchange="voucherHistoryDate=this.value;drawVoucherList('${type}')" style="margin:0;">
                        </div>
                        <div style="height:8px; background:#111; margin:0 -14px 14px;"></div>
                        <div style="display:grid; grid-template-columns:70px 1fr; gap:9px 8px; align-items:center;">
                            <label style="margin:0;">الاسم</label>
                            <input list="global-contacts-list" id="v-name" oninput="updVInfo();autoCompleteName(event)" onkeydown="navNext(event, 'v-amt')" placeholder="اختر الاسم..." style="margin:0;">
                            <label style="margin:0;">المبلغ</label>
                            <input type="number" id="v-amt" oninput="updVInfo()" onkeydown="navNext(event, 'v-note')" style="margin:0;">
                            <label style="margin:0;">الرصيد</label>
                            <input id="v-balance" disabled value="0.00" style="margin:0;">
                            <label style="margin:0;">الباقي</label>
                            <input id="v-after" disabled value="0.00" style="margin:0;">
                        </div>
                        <fieldset style="margin-top:18px; border:1px solid #cbd5e1; padding:12px;">
                            <legend style="font-weight:900;">الملاحظات</legend>
                            <textarea id="v-note" rows="3" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();document.getElementById('btn-v-save').focus();}" style="width:100%; resize:none; font-family:inherit; font-size:.9rem; padding:8px;"></textarea>
                        </fieldset>
                    </div>
                </div>

                <div class="voucher-bottom-bar no-print">
                    <div class="voucher-bottom-totals" id="v-history-footer"></div>
                    <div class="voucher-bottom-actions">
                        <button id="btn-v-save" class="btn btn-primary" style="background:linear-gradient(to bottom,#ff9f1a,#f57c00);" onclick="saveV('${type}')">إضافة</button>
                        <button class="btn btn-success" onclick="editSelectedVoucher('${type}')" title="تعديل" aria-label="تعديل">✏️</button>
                        <button class="btn" style="background:#ffef00; color:#111; text-shadow:none;" onclick="printSelectedVoucher('${type}')">🖨️ الطباعة</button>
                        <button class="btn btn-success whatsapp-btn" onclick="shareViaWhatsApp('${title}')">🟢 واتساب</button>
                    </div>
                </div>
            </div>`;
            window.selectedVoucherId = null;
            drawVoucherList(type);
            focusPrimaryField('v-name');
        }

        function drawVoucherList(type) {
            const body = document.getElementById('v-history-body');
            const footer = document.getElementById('v-history-footer');
            if(!body) return;
            const q = (document.getElementById('v-search')?.value || '').trim().toLowerCase();
            const cMap = {}; state.contacts.forEach(c => cMap[c.id] = c.name);
            let filtered = state.transactions.filter(t => t.type === type);
            if(q) filtered = filtered.filter(t => String(t.id).includes(q) || (cMap[t.contactId]||'').toLowerCase().includes(q));
            filtered.sort((a,b)=>new Date(b.date)-new Date(a.date));
            let totalAmt = 0;
            body.innerHTML = filtered.map((t, idx) => {
                const cName = cMap[t.contactId] || '؟'; totalAmt += Number(t.amount)||0;
                const from = type === 'دفع' ? 'الصندوق' : cName;
                const to = type === 'دفع' ? cName : 'الصندوق';
                const selected = window.selectedVoucherId === t.id ? 'background:#fde68a !important;' : '';
                return `<tr style="cursor:pointer;${selected}" onclick="selectVoucher(${t.id},'${type}')"><td class="v-print-hide">${t.voucherNo || filtered.length-idx}</td><td class="${type==='قبض'?'v-customer':'v-print-hide'}">${from}</td><td class="${type==='دفع'?'v-customer':'v-print-hide'}">${to}</td><td class="v-print-hide">${t.date.split('T')[0]}</td><td>${Number(t.amount).toFixed(2)}</td><td class="no-print">${transactionActionButtons(t.id)}</td></tr>`;
            }).join('');
            footer.innerHTML = `<span class="voucher-total-box">العدد: ${filtered.length}</span><span class="voucher-total-box">المجموع: ${totalAmt.toFixed(2)}</span>`;
        }

        function selectVoucher(id, type) {
            window.selectedVoucherId = id;
            const t = state.transactions.find(x=>x.id===id); if(!t) return;
            const c = state.contacts.find(x=>x.id===t.contactId);
            document.getElementById('v-name').value = c?.name || '';
            document.getElementById('v-amt').value = t.amount;
            document.getElementById('v-note').value = t.details?.notes || '';
            document.getElementById('v-date').value = t.date.split('T')[0];
            updVInfo(); drawVoucherList(type);
        }

        function updVInfo() {
            const n = document.getElementById('v-name')?.value || '', a = parseFloat(document.getElementById('v-amt')?.value) || 0, c = state.contacts.find(x => x.name === n);
            const type = state.activeTab === 'receipt' ? 'قبض' : 'دفع';
            const bal = c ? c.balance : 0; const rem = type === 'قبض' ? bal - a : bal + a;
            const b = document.getElementById('v-balance'), aft = document.getElementById('v-after');
            if(b) b.value = bal.toFixed(2); if(aft) aft.value = rem.toFixed(2);
        }

        async function saveV(type) {
            const n = document.getElementById('v-name').value.trim(), a = parseFloat(document.getElementById('v-amt').value); if(!n || !a) return alert('أدخل البيانات');
            const c = await findOrCreateC(n); if(type==='قبض') c.balance -= a; else c.balance += a;
            const allSame = state.transactions.filter(t=>t.type===type); const voucherNo = allSame.reduce((m,t)=>Math.max(m,Number(t.voucherNo)||0),0)+1;
            const pickedDate = document.getElementById('v-date').value || new Date().toISOString().split('T')[0];
            const newTx = { id: Date.now(), voucherNo, date: pickedDate+'T'+new Date().toTimeString().slice(0,8), type, contactId: c.id, amount: a, details: { notes: document.getElementById('v-note').value } };
            state.transactions.push(newTx); await dbSave('transactions',newTx); await dbSave('contacts',c); renderVoucher(document.getElementById('main'),type);
        }

        async function editSelectedVoucher(type) {
            const id = window.selectedVoucherId; if(!id) return alert('اختر سنداً من الجدول أولاً');
            const t = state.transactions.find(x=>x.id===id); if(!t) return;
            const oldC = state.contacts.find(x=>x.id===t.contactId); if(oldC){ if(type==='قبض') oldC.balance += t.amount; else oldC.balance -= t.amount; await dbSave('contacts',oldC); }
            const n=document.getElementById('v-name').value.trim(), a=parseFloat(document.getElementById('v-amt').value); if(!n||!a) return alert('أدخل البيانات');
            const c=await findOrCreateC(n); if(type==='قبض') c.balance-=a; else c.balance+=a;
            const pickedDate=document.getElementById('v-date').value||t.date.split('T')[0];
            t.contactId=c.id; t.amount=a; t.date=pickedDate+'T'+new Date(t.date).toTimeString().slice(0,8); t.details={...(t.details||{}),notes:document.getElementById('v-note').value};
            await dbSave('transactions',t); await dbSave('contacts',c); renderVoucher(document.getElementById('main'),type);
        }

        function printSelectedVoucher(type){ window.print(); }

        function renderStatement(m) {
            m.innerHTML = `<div class="page-header no-print"><div class="page-title">كشف حساب</div><div class="page-actions"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨️ طباعة</button><button class="btn btn-success btn-sm whatsapp-btn" onclick="shareViaWhatsApp('كشف حساب')">🟢 واتساب</button></div></div>
                <div class="card no-print statement-filters" style="display:grid; grid-template-columns: 1fr 1fr auto; gap:8px; align-items:end;"><div class="statement-name-filter"><label for="st-search">الاسم</label><input list="global-contacts-list" id="st-search" oninput="drawSt();autoCompleteName(event)" onchange="drawSt()" placeholder="اكتب أول حرف من الاسم..." autocomplete="off" style="margin:0;"></div><div><label>من</label><input type="date" id="st-from" onchange="drawSt()" style="margin:0;"></div><div><label>إلى</label><input type="date" id="st-to" onchange="drawSt()" style="margin:0;"></div><button class="btn btn-primary" onclick="drawSt()">عرض</button></div><div id="st-res"></div>`;
        }

        function statementMoveKind(t, c) {
            if (t.type === 'فاتورة') return t.contactId === c.id ? 'شراء' : 'بيع';
            if (t.type === 'قبض') return 'قبض';
            if (t.type === 'دفع') return (t.details?.sourceInvoiceIds?.length ? 'واصل بواسطة الفاتورة' : 'دفع');
            return t.type;
        }

        function drawSt() {
            const name = document.getElementById('st-search').value, fromD = document.getElementById('st-from').value, toD = document.getElementById('st-to').value;
            const c = state.contacts.find(x=>x.name===name); if(!c) { document.getElementById('st-res').innerHTML=''; return; }
            let bal = Number(c.openingBal || 0), seq = 0;
            let txs = state.transactions.filter(t => t.contactId===c.id || t.secondaryId===c.id).sort((a,b)=>new Date(a.date)-new Date(b.date));
            const effect = t => {
                const isI=t.type==='فاتورة', isB=t.contactId===c.id;
                return isI ? (isB ? Number(t.amount||0) : -Number(t.details?.sellerCredit||0)) : (t.type==='قبض' ? -Number(t.amount||0) : Number(t.amount||0));
            };
            txs.forEach(t => { const d=t.date.split('T')[0]; if(fromD && d<fromD) bal += effect(t); });
            const visible = txs.filter(t => { const d=t.date.split('T')[0]; return (!fromD||d>=fromD)&&(!toD||d<=toD); });

            // التجميع يكون حسب اليوم ونوع الحركة معاً: بيع وحده، شراء وحده، قبض وحده، دفع وحده.
            const groups = {};
            visible.forEach(t => {
                const date=t.date.split('T')[0], kind=statementMoveKind(t,c), key=date+'||'+kind;
                if(!groups[key]) groups[key]={date,kind,items:[],firstTime:t.date};
                groups[key].items.push(t);
                if(new Date(t.date)<new Date(groups[key].firstTime)) groups[key].firstTime=t.date;
            });

            let rows='';
            Object.values(groups).sort((a,b)=>new Date(a.firstTime)-new Date(b.firstTime)).forEach(g => {
                seq++; let debit=0, credit=0, totalQty=0;
                g.items.forEach(t => {
                    const isI=t.type==='فاتورة', isB=t.contactId===c.id;
                    if(isI) { totalQty += Number(t.details?.tQty||0); if(isB) debit += Number(t.amount||0); else credit += Number(t.details?.sellerCredit||0); }
                    else if(t.type==='قبض') credit += Number(t.amount||0); else if(t.type==='دفع') debit += Number(t.amount||0);
                });
                bal += debit-credit;
                const label = g.kind==='بيع' ? 'مبيعات' : g.kind==='شراء' ? 'مشتريات' : g.kind==='قبض' ? 'وصل قبض' : g.kind==='دفع' ? 'وصل دفع' : g.kind==='واصل بواسطة الفاتورة' ? 'واصل بواسطة الفاتورة' : g.kind;
                rows += `<tr ondblclick="openStatementGroupDetails('${g.date}', '${g.kind}', ${JSON.stringify(c.id)})" title="انقر مرتين لعرض تفاصيل ${label}" style="cursor:pointer;">
                    <td>${seq}</td><td>${c.name}</td><td>${g.date}</td><td>${label} (${g.items.length})</td><td>${totalQty || '-'}</td>
                    <td>${debit.toFixed(2)}</td><td>${credit.toFixed(2)}</td><td style="font-weight:900">${bal.toFixed(2)}</td></tr>`;
            });
            document.getElementById('st-res').innerHTML = `<div class="print-only-header"><h2>كشف حساب: ${c.name}</h2><span class="date">التاريخ: ${getPrintDate()}</span></div>
                <div class="card" style="padding:0; overflow:hidden;"><table><thead><tr><th>ت</th><th>الزبون</th><th>التاريخ</th><th>الحالة</th><th>مجموع العدد</th><th>عليه</th><th>له</th><th>الرصيد</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="8" style="text-align:center">لا توجد حركات</td></tr>'}</tbody></table></div>`;
        }

        function getStatementTxNo(tx) {
            const sameType = state.transactions.filter(x => x.type === tx.type).sort((a,b)=>new Date(a.date)-new Date(b.date));
            const n = sameType.findIndex(x => x.id === tx.id) + 1; return n > 0 ? n : 0;
        }

        function openStatementGroupDetails(date, kind, contactId) {
            const c=state.contacts.find(x=>x.id===contactId); if(!c) return;
            const items=state.transactions.filter(t=>(t.contactId===c.id||t.secondaryId===c.id)&&t.date.startsWith(date)&&statementMoveKind(t,c)===kind).sort((a,b)=>new Date(a.date)-new Date(b.date));
            let body='', totalQty=0, totalAmount=0;
            items.forEach((t,i)=>{
                const isI=t.type==='فاتورة', isB=t.contactId===c.id; let amount=0,status='',qty='-',price='-',no=getStatementTxNo(t);
                if(isI){ qty=Number(t.details?.tQty||0); const raw=Number(t.details?.raw||0); price=qty?(raw/qty).toFixed(2):'0.00'; if(isB){amount=Number(t.amount||0);status='شراء';}else{amount=Number(t.details?.sellerCredit||0);status='بيع';}}
                else if(t.type==='قبض'){amount=Number(t.amount||0);status='قبض';} else if(t.type==='دفع'){amount=Number(t.amount||0);status='دفع';}
                if(isI) totalQty += Number(qty)||0;
                totalAmount += amount;
                body += `<tr ${isI ? `ondblclick="openEdit(${JSON.stringify(t.id)}, 'tx')" title="انقر مرتين لفتح الفاتورة وتعديلها" style="cursor:pointer;"` : ''}><td>${i+1}</td><td>${no}</td><td>${status}</td><td>${qty}</td><td>${price}</td><td>${amount.toFixed(2)}</td><td class="no-print" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"><div class="row-actions"><button type="button" class="btn btn-primary btn-sm" onclick="openEdit(${JSON.stringify(t.id)}, 'tx')" title="تعديل المعاملة" aria-label="تعديل المعاملة">✏️</button><button type="button" class="btn btn-danger btn-sm" onclick="deleteStatementDetail(${JSON.stringify(t.id)}, '${date}', '${kind}', ${JSON.stringify(contactId)})" title="حذف المعاملة" aria-label="حذف المعاملة">🗑️</button></div></td></tr>`;
            });
            const title = kind==='بيع'?'تفاصيل المبيعات':kind==='شراء'?'تفاصيل المشتريات':kind==='قبض'?'تفاصيل القبض':kind==='واصل بواسطة الفاتورة'?'تفاصيل واصل بواسطة الفاتورة':'تفاصيل الدفع';
            document.getElementById('modal-title').textContent=`${title} - ${date}`;
            document.getElementById('modal-content').innerHTML=`<div style="max-height:420px;overflow:auto"><table><thead><tr><th>ت</th><th>رقم</th><th>الحركة</th><th>العدد</th><th>السعر</th><th>المبلغ</th><th class="no-print">إجراء</th></tr></thead><tbody>${body}</tbody><tfoot><tr class="tfoot-yellow"><td colspan="3" style="text-align:center;font-weight:900">المجاميع</td><td style="font-weight:900">مجموع العدد: ${totalQty}</td><td></td><td style="font-weight:900">مجموع المبلغ: ${totalAmount.toFixed(2)}</td><td class="no-print"></td></tr></tfoot></table></div>`;
            const modal=document.getElementById('edit-modal'); const actions=modal.querySelector('.modal-box > div:last-child');
            if(actions) actions.innerHTML=`<button class="btn btn-primary" style="flex:1" onclick="printStatementDetails()">🖨️ طباعة</button><button class="btn btn-success whatsapp-btn" style="flex:1" onclick="shareViaWhatsApp('تفاصيل كشف الحساب','edit-modal')">🟢 واتساب</button><button class="btn btn-danger" style="flex:1" onclick="closeModal()">إغلاق</button>`;
            modal.querySelector('.modal-box').style.width='900px'; modal.classList.remove('hidden');
        }

        function printStatementDetails() {
            const modal = document.getElementById('edit-modal');
            if(!modal) return;
            const table = document.querySelector('#modal-content table');
            if(!table) return;
            const title = document.getElementById('modal-title')?.textContent || 'تفاصيل كشف الحساب';
            const customerName = document.getElementById('st-search')?.value || '';
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            let totalQty = 0, totalAmount = 0;
            const printRows = rows.map(row => {
                const cells = row.querySelectorAll('td');
                const move = cells[2]?.textContent.trim() || '';
                const qty = cells[3]?.textContent.trim() || '-';
                const price = cells[4]?.textContent.trim() || '0.00';
                const amount = cells[5]?.textContent.trim() || '0.00';
                totalQty += Number(qty) || 0;
                totalAmount += Number(amount) || 0;
                return `<tr><td>${move}</td><td>${qty}</td><td>${price}</td><td>${amount}</td></tr>`;
            }).join('');
            const cleanTable = document.createElement('table');
            cleanTable.innerHTML = `<thead><tr><th>الحركة</th><th>العدد</th><th>السعر</th><th>المبلغ</th></tr></thead><tbody>${printRows}</tbody><tfoot><tr><td style="font-weight:900">المجاميع</td><td style="font-weight:900">مجموع العدد: ${totalQty}</td><td></td><td style="font-weight:900">مجموع المبلغ: ${totalAmount.toFixed(2)}</td></tr></tfoot>`;
            const w = window.open('', '_blank', 'width=1000,height=700');
            if(!w) return;
            w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${title}</title><style>
                @page{size:A4;margin:12mm}
                *{box-sizing:border-box}
                body{font-family:Arial,sans-serif;color:#000;margin:0;padding:0;direction:rtl}
                .print-head{text-align:center;margin-bottom:14px}
                .print-head .name{font-size:20px;font-weight:700;margin-bottom:5px}
                .print-head .title{font-size:15px;font-weight:700}
                table{width:100%;border-collapse:collapse;table-layout:fixed;direction:rtl}
                th,td{border:1px solid #000;padding:7px 5px;text-align:center;font-size:12px;vertical-align:middle}
                th{font-weight:700;background:#eee}
                tfoot td{font-weight:700;background:#38bdf8}
                @media print{body{padding:0}.print-head{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}thead{display:table-header-group}tfoot{display:table-row-group}}
            </style></head><body><div class="print-head"><div class="name">${customerName}</div><div class="title">${title}</div></div>${cleanTable.outerHTML}</body></html>`);
            w.document.close();
            w.focus();
            setTimeout(()=>w.print(),200);
        }

        function renderContacts(m) {
            m.innerHTML = `<div class="page-header"><div class="page-title">إدارة الأسماء</div><button class="btn btn-primary btn-sm" onclick="openEdit(null, 'contact')">+ إضافة اسم</button></div>
                <div class="card no-print"><input id="c-search" placeholder="بحث سريع..." oninput="drawC()" style="margin:0;"></div>
                <div class="card" style="padding:0; overflow:hidden;"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th>افتتاحي</th><th>إجراء</th></tr></thead><tbody id="c-body"></tbody></table></div>`;
            drawC();
        }
        function drawC() {
            const s = document.getElementById('c-search').value.toLowerCase();
            document.getElementById('c-body').innerHTML = state.contacts.filter(c => c.name.toLowerCase().includes(s)).map(c => `<tr><td>${c.name}</td><td>${c.phone||'-'}</td><td>${c.address||'-'}</td><td>${c.openingBal.toFixed(2)}</td><td>${contactActionButtons(c.id)}</td></tr>`).join('');
        }

        function renderBalances(m) {
            m.innerHTML = `<div class="page-header no-print"><div class="page-title">الأرصدة</div><div class="page-actions"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨️ طباعة</button><button class="btn btn-success btn-sm whatsapp-btn" onclick="shareViaWhatsApp('كشف الأرصدة')">🟢 واتساب</button></div></div>
                <div class="card no-print"><input id="b-search" placeholder="بحث..." oninput="drawB()" style="margin:0;"></div>
                <div class="card" style="padding:0; overflow:hidden;"><div class="print-only-header"><h2>كشف أرصدة العملاء</h2><span class="date">التاريخ: ${getPrintDate()}</span></div><table><thead><tr><th>الاسم</th><th>تاريخ آخر دفعة</th><th>قيمة آخر دفعة</th><th style="color:red">مدين (عليه)</th><th style="color:green">دائن (له)</th></tr></thead><tbody id="b-body"></tbody><tfoot id="b-foot" class="tfoot-custom"></tfoot></table></div>`;
            drawB();
        }
        function drawB() {
            const s = document.getElementById('b-search')?.value.toLowerCase() || '';
            const filtered = state.contacts.filter(c => Math.round(c.balance)!==0 && c.name.toLowerCase().includes(s)).sort((a,b)=>b.balance-a.balance);
            const lastPayMap = {};
            state.transactions.forEach(t => { if(t.type === 'قبض' || t.type === 'دفع') { if(!lastPayMap[t.contactId] || t.date > lastPayMap[t.contactId].date) { lastPayMap[t.contactId] = { date: t.date.split('T')[0], amount: t.amount }; } } });
            document.getElementById('b-body').innerHTML = filtered.map(c => {
                const lastP = lastPayMap[c.id]; const lastPDate = lastP ? lastP.date : '-'; const lastPAmt = lastP ? lastP.amount.toFixed(2) : '-';
                return `<tr><td>${c.name}</td><td>${lastPDate}</td><td>${lastPAmt}</td><td style="color:black">${c.balance>0?c.balance.toFixed(2):'-'}</td><td style="color:black">${c.balance<0?Math.abs(c.balance).toFixed(2):'-'}</td></tr>`;
            }).join('');
            const deb = filtered.filter(c=>c.balance>0).reduce((a,b)=>a+b.balance,0), cre = Math.abs(filtered.filter(c=>c.balance<0).reduce((a,b)=>a+b.balance,0));
            document.getElementById('b-foot').innerHTML = `<tr><td colspan="3">الإجمالي</td><td style="color:white">${deb.toFixed(2)}</td><td style="color:white">${cre.toFixed(2)}</td></tr>`;
        }

        function renderReports(m) {
            const today = new Date().toISOString().split('T')[0];
            m.innerHTML = `<div class="page-header no-print"><div class="page-title">التقارير</div><div class="page-actions"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨️ طباعة</button><button class="btn btn-success btn-sm whatsapp-btn" onclick="shareViaWhatsApp('التقارير')">🟢 واتساب</button></div></div>
                <div class="card no-print report-filters" style="display:grid; grid-template-columns: 1fr 1fr 1fr auto; gap:8px; align-items:end;">
                    <div><label>من</label><input type="date" id="rep-from" value="${today}" style="margin:0;"></div>
                    <div><label>إلى</label><input type="date" id="rep-to" value="${today}" style="margin:0;"></div>
                    <div><label>بحث بالاسم</label><input type="text" id="rep-search" oninput="drawRep(window.currentRepType)" style="margin:0;"></div>
                    <button class="btn btn-primary" onclick="drawRep(window.currentRepType)">بحث</button>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:12px;" class="no-print">
                    <button class="btn btn-primary" style="flex:1" onclick="drawRep('sales')">تقرير المبيعات</button>
                    <button class="btn btn-success" style="flex:1" onclick="drawRep('purchases')">تقرير المشتريات</button>
                </div>
                <div id="rep-res" style="display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 15px;"></div>`;
            drawRep('sales');
        }
        
        async function payPurchaseGroup(txIds) {
            const invoices = txIds.map(id => state.transactions.find(x => x.id == id && x.type === 'فاتورة')).filter(Boolean);
            const unpaid = invoices.filter(t => !t.details?.purchasePaid);
            if(!unpaid.length) return;
            const sellerId = unpaid[0].secondaryId;
            const seller = state.contacts.find(x => x.id === sellerId);
            if(!seller) return;
            const amount = unpaid.reduce((sum,t)=>sum + Number(t.details?.sellerCredit || 0), 0);
            if(amount <= 0) return;


            const payTx = {
                id: Date.now() + Math.random(),
                date: new Date().toISOString(),
                type: 'دفع',
                contactId: seller.id,
                amount: amount,
                details: { notes: 'واصل مجموع تقرير المشتريات', sourceInvoiceIds: unpaid.map(t=>t.id) }
            };
            seller.balance += amount;
            unpaid.forEach(t => {
                t.details = t.details || {};
                t.details.purchasePaid = true;
                t.details.purchasePaidTxId = payTx.id;
                t.details.purchasePaidAt = payTx.date;
            });

            state.transactions.push(payTx);
            await dbSave('transactions', payTx);
            for(const t of unpaid) await dbSave('transactions', t);
            await dbSave('contacts', seller);
            drawRep('purchases');
        }

        function drawRep(type) {
            window.currentRepType = type; const isS = type==='sales', from = document.getElementById('rep-from')?.value, to = document.getElementById('rep-to')?.value, nameSearch = document.getElementById('rep-search')?.value.toLowerCase() || '';
            let gQ=0, gR=0, gFD=0, gN=0, html='', groups={}; const cMap = {}; state.contacts.forEach(c => cMap[c.id] = c); 
            state.transactions.filter(t => t.type==='فاتورة').forEach(t => {
                const d = t.date.split('T')[0]; if((from && d<from)||(to && d>to)) return;
                const cId = isS ? t.contactId : t.secondaryId; const c = cMap[cId]; if(!c || (nameSearch && !c.name.toLowerCase().includes(nameSearch))) return;
                if(!groups[c.name]) groups[c.name] = {items:[], q:0, r:0, fd:0, n:0};
                const fd = isS ? (t.details.bFee || 0) : (t.details.sTotalDisc || (t.details.raw - t.details.sellerCredit));
                const n = isS ? t.amount : t.details.sellerCredit;
                groups[c.name].items.push({id:t.id, date:t.date, q:t.details.tQty, p:t.details.raw/t.details.tQty, r:t.details.raw, fd, n, paid:!!t.details.purchasePaid});
                groups[c.name].q+=t.details.tQty; groups[c.name].r+=t.details.raw; groups[c.name].fd+=fd; groups[c.name].n+=n;
                gQ+=t.details.tQty; gR+=t.details.raw; gFD+=fd; gN+=n;
            });
            for(let n in groups) {
                const g = groups[n];
                const rows = g.items.map(i=> isS
                    ? `<tr><td>شراء</td><td>${i.q}</td><td>${i.p.toFixed(2)}</td><td style="font-weight:bold">${i.n.toFixed(2)}</td><td class="no-print">${transactionActionButtons(i.id)}</td></tr>`
                    : `<tr><td>${i.date.split('T')[0]}</td><td>${i.q}</td><td>${i.p.toFixed(2)}</td><td>${i.r.toFixed(2)}</td><td>${i.fd.toFixed(2)}</td><td style="font-weight:bold">${i.n.toFixed(2)}</td><td class="no-print">${transactionActionButtons(i.id)}</td></tr>`).join('');
                const unpaidItems = g.items.filter(i=>!i.paid);
                const allPaid = !isS && unpaidItems.length===0 && g.items.length>0;
                const footExtra = !isS ? `<td class="no-print" style="text-align:center;"><button class="btn btn-sm-tiny ${allPaid?'btn-success':'btn-danger'}" ${allPaid?'disabled':''} style="${allPaid?'background:#16a34a !important;color:white !important;opacity:1;':''}" onclick='payPurchaseGroup(${JSON.stringify(g.items.map(i=>i.id))})'>${allPaid?'تم الواصل ✓':'واصل'}</button></td>` : '';
                const reportHead = isS
                    ? '<tr><th>الحركة</th><th>العدد</th><th>السعر</th><th>الصافي</th><th class="no-print">إجراء</th></tr>'
                    : '<tr><th>التاريخ</th><th>العدد</th><th>السعر</th><th>المجموع</th><th>الخـصم</th><th>الصافي</th><th class="no-print">إجراء</th></tr>';
                const reportFoot = isS
                    ? `<tr><td>المجموع</td><td>${g.q}</td><td>-</td><td>${g.n.toFixed(2)}</td><td class="no-print"></td></tr>`
                    : `<tr><td>المجموع</td><td>${g.q}</td><td>-</td><td>${g.r.toFixed(2)}</td><td>${g.fd.toFixed(2)}</td><td>${g.n.toFixed(2)}</td>${footExtra}</tr>`;
                html += `<div class="card" style="padding:0; overflow:hidden; margin-bottom:0; display:flex; flex-direction:column; height:100%;"><div class="print-only-header"><h2>تقرير ${isS?'المبيعات':'المشتريات'}</h2><span class="date">التاريخ: ${getPrintDate()}</span></div><div class="group-header"><span>${n}</span></div><div style="flex:1; overflow-y:auto;"><table><thead>${reportHead}</thead><tbody>${rows}</tbody></table></div><table style="margin-top:auto;"><tfoot class="tfoot-yellow">${reportFoot}</tfoot></table></div>`;
            }
            document.getElementById('rep-res').innerHTML = html;
            document.getElementById('global-footer-container').innerHTML = isS
                ? `<div class="global-footer no-print"><div class="stat-box">مجموع العدد: <b>${gQ}</b></div><div class="stat-box">مجموع الصافي: <b>${gN.toFixed(2)}</b></div></div>`
                : `<div class="global-footer no-print"><div class="stat-box">العـدد: <b>${gQ}</b></div><div class="stat-box">الاجمالي: <b>${gR.toFixed(2)}</b></div><div class="stat-box">الخـصم: <b>${gFD.toFixed(2)}</b></div><div class="stat-box">الصافي: <b>${gN.toFixed(2)}</b></div></div>`;
        }

        window.toggleSettLock = function() { settLocked = !settLocked; renderPage(); };

        function renderSettings(m) {
            const s = state.settings; const lk = settLocked ? 'disabled' : ''; const btnCls = settLocked ? 'btn-danger' : 'btn-success'; const btnTxt = settLocked ? '🔒 تعديل الجباية والخصم (مقفل)' : '🔓 تعديل الجباية والخصم (مفتوح)';
            const fiscalYear = escapeHTML(s.fiscalYear || new Date().getFullYear());
            const lastBackup = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString('ar-IQ') : 'لم تُنشأ نسخة بعد';
            const cloudReady = Boolean(window.ghazaliCloud?.available && s.cloudSyncKey === window.ghazaliCloud?.personalSyncKey);
            const lastCloudSync = s.cloudSyncAt ? new Date(s.cloudSyncAt).toLocaleString('ar-IQ') : 'بانتظار أول مزامنة';
            m.innerHTML = `<div class="page-header"><div class="page-title">إعدادات النظام</div></div><div class="card" style="max-width:550px; margin:auto;">
                <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; margin-bottom:10px;">
                    <div style="padding:8px; text-align:center; border-radius:10px; background:#f2f3ff; color:#343170;"><small>السنة</small><strong style="display:block; margin-top:3px;">${fiscalYear}</strong></div>
                    <div style="padding:8px; text-align:center; border-radius:10px; background:#effaf8; color:#176b68;"><small>الأسماء</small><strong style="display:block; margin-top:3px;">${state.contacts.length}</strong></div>
                    <div style="padding:8px; text-align:center; border-radius:10px; background:#fff7e7; color:#8a5a12;"><small>المعاملات</small><strong style="display:block; margin-top:3px;">${state.transactions.length}</strong></div>
                </div>
                <div style="margin-bottom:12px; padding:7px 10px; border-radius:9px; background:#f6f7fa; color:#5c6074; font-size:.78rem;">🛡️ آخر نسخة احتياطية: <strong>${lastBackup}</strong></div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div><label>المستخدم</label><input id="s-u" value="${s.user}" style="margin:0;"></div>
                    <div><label>كلمة المرور</label><input type="password" id="s-p" value="${s.pass}" style="margin:0;"></div>
                </div>
                <div style="border-top:2px solid #cbd5e1; padding-top:10px; margin-top:10px;">
                    <button class="btn ${btnCls} w-full" style="width:100%; margin-bottom:12px; font-size:1rem;" onclick="toggleSettLock()">${btnTxt}</button>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div><label>الارضيه مشتري</label><input type="number" id="s-bf" value="${s.buyerFee}" style="margin:0;" ${lk}></div>
                        <div><label>الارضيه بائع</label><input type="number" id="s-sd" value="${s.sellerDisc}" style="margin:0;" ${lk}></div>
                        <div><label>دلالــية%</label><input type="number" id="s-p1" value="${s.p1}" style="margin:0;" ${lk}></div>
                        <div><label>خصم%</label><input type="number" id="s-p2" value="${s.p2}" style="margin:0;" ${lk}></div>
                    </div>
                </div>
                <button class="btn btn-primary w-full" style="width:100%; margin-top:15px;" onclick="saveSett()">💾 حفظ الإعدادات</button>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button class="btn btn-success" style="flex:1" onclick="exportData()">📤 تصدير نسخة</button>
                    <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('imp-f').click()">📥 استيراد نسخة</button>
                    <input type="file" id="imp-f" class="hidden" onchange="importData(event)">
                </div>
                <div style="margin-top:14px; padding:12px; border:1px solid #b9ddd6; border-radius:12px; background:linear-gradient(180deg,#f2fffc,#e7f7f4);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px;">
                        <strong style="color:#176b68;">☁️ مزامنة الأجهزة</strong>
                        <span style="padding:4px 10px; border-radius:999px; background:${cloudReady?'#d8f5e9':'#ffe6e6'}; color:${cloudReady?'#137456':'#a02b3b'}; font-size:.74rem; font-weight:900;">${cloudReady?'متصلة':'غير متصلة'}</span>
                    </div>
                    <p style="margin:0; color:#555870; font-size:.8rem; line-height:1.6;">آخر مزامنة: <strong>${escapeHTML(lastCloudSync)}</strong><br>هذه قاعدة شخصية واحدة؛ أي جهاز يفتح نفس البرنامج يجلب الأسماء والمعاملات نفسها تلقائياً.</p>
                </div>
                <div style="margin-top:14px; padding:12px; border:1px solid #c8c9ef; border-radius:12px; background:linear-gradient(180deg,#f7f7ff,#eceefe);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                        <strong style="color:#343170;">📅 السنة المالية الحالية</strong>
                        <span style="padding:4px 12px; border-radius:999px; background:#fff; color:#343170; font-weight:900; box-shadow:inset 0 1px 3px rgba(49,46,99,.18);">${fiscalYear}</span>
                    </div>
                    <p style="margin:0 0 10px; color:#555870; font-size:.82rem; line-height:1.6;">ينزّل نسخة كاملة للسنة الحالية، ثم يحتفظ بالأسماء والأرصدة المدورة فقط ويبدأ سجل معاملات جديد.</p>
                    <button class="btn btn-primary w-full" style="width:100%;" onclick="openFiscalYearModal()">🗓️ حفظ السنة وبدء سنة جديدة</button>
                </div>
                <button class="btn btn-danger w-full" style="width:100%; margin-top:10px;" onclick="openWipeLock()">⚠️ مسح شامل للنظام</button>
            </div>`;
        }
        async function saveSett() { state.settings = { ...state.settings, user:document.getElementById('s-u').value, pass:document.getElementById('s-p').value, buyerFee:parseFloat(document.getElementById('s-bf').value)||0, sellerDisc:parseFloat(document.getElementById('s-sd').value)||0, p1:parseFloat(document.getElementById('s-p1').value)||0, p2:parseFloat(document.getElementById('s-p2').value)||0 }; await dbSave("settings", state.settings); alert('تم حفظ الإعدادات'); settLocked = true; renderPage(); }
        
        function safeFilePart(value) {
            return String(value || '').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'data';
        }

        function escapeHTML(value) {
            return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
        }

        function downloadBackupFile(payload, prefix = 'Backup') {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${safeFilePart(prefix)}_${stamp}.json`;
            const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
            const a = document.createElement('a');
            a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return filename;
        }

        async function exportData() {
            const exportedAt = new Date().toISOString();
            const payload = JSON.parse(JSON.stringify(state));
            payload.settings = { ...payload.settings, lastBackupAt:exportedAt };
            payload.backupInfo = { type:'manual', exportedAt, fiscalYear:String(state.settings?.fiscalYear || new Date().getFullYear()) };
            const filename = downloadBackupFile(payload, 'Ghazali_Backup');
            state.settings = { ...state.settings, lastBackupAt:exportedAt };
            await dbSave('settings', state.settings);
            alert(`تم تنزيل النسخة الاحتياطية:\n${filename}`);
            if(state.activeTab === 'settings') renderPage();
        }

        function openFiscalYearModal() {
            const modal = document.getElementById('edit-modal');
            const content = document.getElementById('modal-content');
            const actions = modal.querySelector('.modal-box > div:last-child');
            const currentYear = String(state.settings?.fiscalYear || new Date().getFullYear());
            const numericYear = /^\d{4}$/.test(currentYear) ? Number(currentYear) : new Date().getFullYear();
            document.getElementById('modal-title').innerText = 'بدء سنة مالية جديدة';
            content.innerHTML = `<div style="padding:10px; margin-bottom:12px; border-radius:10px; background:#fff7d6; color:#5d4700; line-height:1.7; font-size:.86rem;">
                    <strong>ما الذي سيحدث؟</strong><br>
                    1. تنزيل نسخة كاملة من السنة الحالية.<br>
                    2. حذف الفواتير والسندات من السنة الجديدة.<br>
                    3. إبقاء جميع الأسماء، ويصبح الرصيد الحالي هو الرصيد المدور.
                </div>
                <label>السنة الجديدة</label><input id="fiscal-new-year" value="${numericYear + 1}" inputmode="numeric">
                <label>رمز الحماية</label><input type="password" id="fiscal-code" placeholder="أدخل رمز الحماية" autocomplete="off">`;
            actions.innerHTML = `<button class="btn btn-success" style="flex:1" onclick="startNewFiscalYear()">تنزيل النسخة والبدء</button><button class="btn btn-danger" style="flex:1" onclick="closeModal()">إلغاء</button>`;
            modal.querySelector('.modal-box').style.width = 'min(460px, calc(100vw - 24px))';
            window.editId = null; window.editType = 'fiscal-year';
            modal.classList.remove('hidden');
            setTimeout(() => document.getElementById('fiscal-new-year')?.focus(), 50);
        }

        async function startNewFiscalYear() {
            const currentYear = String(state.settings?.fiscalYear || new Date().getFullYear());
            const newYear = document.getElementById('fiscal-new-year')?.value.trim();
            const code = document.getElementById('fiscal-code')?.value || '';
            if(!newYear) return alert('أدخل اسم أو رقم السنة الجديدة');
            if(newYear.length > 30 || !/^[\p{L}\p{N}\s._/-]+$/u.test(newYear)) return alert('اسم السنة يجب أن يكون قصيراً ويحتوي على حروف أو أرقام فقط');
            if(newYear === currentYear) return alert('السنة الجديدة يجب أن تختلف عن السنة الحالية');
            if(code !== '1001') { const field=document.getElementById('fiscal-code'); if(field){field.value='';field.focus();} return alert('رمز الحماية غير صحيح'); }
            if(!confirm(`سيتم حفظ نسخة السنة ${currentYear} ثم حذف جميع معاملاتها وبدء السنة ${newYear}. هل تريد المتابعة؟`)) return;

            const closedAt = new Date().toISOString();
            const archive = JSON.parse(JSON.stringify(state));
            archive.backupInfo = {
                type:'fiscal-year-closing',
                exportedAt:closedAt,
                closedFiscalYear:currentYear,
                nextFiscalYear:newYear,
                contactCount:state.contacts.length,
                transactionCount:state.transactions.length
            };
            const filename = downloadBackupFile(archive, `Ghazali_Closing_${currentYear}`);
            const carriedContacts = state.contacts.map(contact => {
                const carriedBalance = Number(contact.balance) || 0;
                return { ...contact, openingBal:carriedBalance, balance:carriedBalance };
            });
            const newSettings = { ...state.settings, fiscalYear:newYear, previousFiscalYear:currentYear, fiscalYearStartedAt:closedAt, lastBackupAt:closedAt };

            try {
                await new Promise((resolve,reject) => {
                    const tx = db.transaction(['contacts','transactions','settings'], 'readwrite');
                    const contactsStore = tx.objectStore('contacts');
                    contactsStore.clear();
                    tx.objectStore('transactions').clear();
                    carriedContacts.forEach(contact => contactsStore.put(contact));
                    tx.objectStore('settings').put(newSettings);
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
                state = { ...state, contacts:carriedContacts, transactions:[], invoiceItems:[], settings:newSettings, activeTab:'dashboard' };
                scheduleCloudSync();
                closeModal(); renderSidebar(); renderPage(); updateDatalist();
                alert(`تم بدء السنة المالية ${newYear}.\nتم تنزيل نسخة السنة السابقة باسم:\n${filename}\n\nبقيت الأسماء والأرصدة المدورة فقط.`);
            } catch(err) {
                console.error(err);
                alert(`تعذر بدء السنة الجديدة، ولم تُغيّر البيانات. النسخة الاحتياطية نُزّلت باسم:\n${filename}`);
            }
        }
        
        // عند الاستيراد نعيد حساب كل فاتورة من العدد والسعر حسب إعدادات البرنامج الحالية،
        // وليس حسب القيم القديمة الموجودة داخل ملف النسخة المستوردة.
        // القيم الافتراضية: أرضية المشتري 2.5، أرضية البائع 0.5، الدلالية 2.5%، وكلها قابلة للتعديل من الإعدادات.
        function recalcImportedData(imported, activeSettings) {
            const sett = activeSettings || state.settings || { buyerFee:2.5, sellerDisc:0.5, p1:2.5, p2:0 };
            const buyerFee = Number(sett.buyerFee) || 0;
            const sellerDisc = Number(sett.sellerDisc) || 0;
            const p1 = Number(sett.p1) || 0;
            const p2 = Number(sett.p2) || 0;

            const contactsById = new Map(imported.contacts.map(c => {
                c.openingBal = Number(c.openingBal) || 0;
                c.balance = c.openingBal;
                return [c.id, c];
            }));

            // أولاً: حساب الفواتير من بياناتها الأصلية (العدد × السعر).
            imported.transactions.forEach(t => {
                if(t.type !== 'فاتورة') return;
                t.details = t.details || {};
                const qty = Number(t.details.tQty) || 0;
                const raw = Number(t.details.raw) || 0;
                const bFee = qty * buyerFee;
                const sDisc = qty * sellerDisc;
                const d1 = raw * (p1 / 100);
                const d2 = (raw - d1) * (p2 / 100);
                const finalB = raw + bFee;
                const finalS = raw - sDisc - d1 - d2;
                t.amount = finalB;
                t.details.bFee = bFee;
                t.details.sellerCredit = finalS;
                t.details.sTotalDisc = raw - finalS;
            });

            // ثانياً: إذا كان هناك "واصل" مرتبط بفواتير مشتريات، حدّث مبلغه حسب الصافي الجديد.
            imported.transactions.forEach(t => {
                if(t.type !== 'دفع' || !Array.isArray(t.details?.sourceInvoiceIds) || !t.details.sourceInvoiceIds.length) return;
                const ids = new Set(t.details.sourceInvoiceIds.map(String));
                t.amount = imported.transactions
                    .filter(x => x.type === 'فاتورة' && ids.has(String(x.id)))
                    .reduce((sum, x) => sum + (Number(x.details?.sellerCredit) || 0), 0);
            });

            // ثالثاً: إعادة بناء الأرصدة حسب الفواتير والسندات بعد تطبيق الخصم والأرضية.
            imported.transactions.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(t => {
                if(t.type === 'فاتورة') {
                    const buyer = contactsById.get(t.contactId);
                    const seller = contactsById.get(t.secondaryId);
                    if(buyer) buyer.balance += Number(t.amount) || 0;
                    if(seller) seller.balance -= Number(t.details?.sellerCredit) || 0;
                } else if(t.type === 'قبض') {
                    const c = contactsById.get(t.contactId); if(c) c.balance -= Number(t.amount) || 0;
                } else if(t.type === 'دفع') {
                    const c = contactsById.get(t.contactId); if(c) c.balance += Number(t.amount) || 0;
                }
            });
            return imported;
        }

        async function importData(e) {
            const f = e.target.files[0]; if(!f) return; const r = new FileReader();
            r.onload = async (ev) => {
                let safetyFilename = '';
                try {
                    let imported = JSON.parse(ev.target.result);
                    if(!imported || !Array.isArray(imported.contacts) || !Array.isArray(imported.transactions) || !imported.settings || typeof imported.settings !== 'object') throw new Error('invalid backup');
                    const importedYear = String(imported.settings.fiscalYear || imported.backupInfo?.fiscalYear || 'غير محددة');
                    const approved = confirm(`سيتم استيراد النسخة التالية:\nالسنة: ${importedYear}\nالأسماء: ${imported.contacts.length}\nالمعاملات: ${imported.transactions.length}\n\nسيتم تنزيل نسخة حماية من بياناتك الحالية أولاً. هل تريد المتابعة؟`);
                    if(!approved) { e.target.value=''; return; }

                    const safetyAt = new Date().toISOString();
                    const safetyCopy = JSON.parse(JSON.stringify(state));
                    safetyCopy.backupInfo = {
                        type:'pre-import-safety',
                        exportedAt:safetyAt,
                        sourceFilename:f.name,
                        fiscalYear:String(state.settings?.fiscalYear || new Date().getFullYear())
                    };
                    safetyFilename = downloadBackupFile(safetyCopy, 'Ghazali_Before_Import');

                    const activeSettings = {
                        ...state.settings,
                        fiscalYear: imported.settings.fiscalYear || state.settings.fiscalYear,
                        previousFiscalYear: imported.settings.previousFiscalYear,
                        fiscalYearStartedAt: imported.settings.fiscalYearStartedAt,
                        lastBackupAt:safetyAt
                    };
                    imported = recalcImportedData(imported, activeSettings);
                    // احتفظ بإعدادات هذا البرنامج الحالية بعد الاستيراد كي تبقى القيم التي اختارها المستخدم هي المعتمدة.
                    imported.settings = activeSettings;
                    await new Promise((resolve,reject)=>{
                        const tx=db.transaction(["contacts","transactions","settings"],"readwrite");
                        const contactsStore=tx.objectStore("contacts"), transactionsStore=tx.objectStore("transactions"), settingsStore=tx.objectStore("settings");
                        contactsStore.clear(); transactionsStore.clear(); settingsStore.clear();
                        imported.contacts.forEach(c=>contactsStore.put(c));
                        imported.transactions.forEach(t=>transactionsStore.put(t));
                        settingsStore.put(imported.settings);
                        tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
                    });
                    state = imported;
                    scheduleCloudSync();
                    alert(`تم الاستيراد بنجاح.\nنسخة الحماية من بياناتك السابقة:\n${safetyFilename}`);
                    location.reload();
                } catch(err) {
                    console.error(err);
                    alert(safetyFilename ? `تعذر إكمال الاستيراد، ولم يتم استبدال بياناتك.\nنسخة الحماية محفوظة باسم:\n${safetyFilename}` : 'ملف النسخة غير صالح أو تالف');
                    e.target.value='';
                }
            }; r.readAsText(f);
        }

        function openWipeLock() { document.getElementById('wipe-lock-modal').classList.remove('hidden'); }
        function closeWipeLock() { document.getElementById('wipe-lock-modal').classList.add('hidden'); }
        function verifyWipeCode() { if (document.getElementById('wipe-pass-input').value === '1977') { if(confirm('هل أنت متأكد؟')) { indexedDB.deleteDatabase(DB_NAME); location.reload(); } } else alert('الرمز خاطئ'); }

        async function dbDelete(storeName, id) {
            return new Promise((resolve,reject)=>{ const tx=db.transaction(storeName,'readwrite'); tx.objectStore(storeName).delete(id); tx.oncomplete=()=>{ scheduleCloudSync(); resolve(); }; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error); });
        }
        async function detachInvoicePayment(invoice) {
            const payId=invoice?.details?.purchasePaidTxId;
            if(!payId) { if(invoice?.details){ delete invoice.details.purchasePaid; delete invoice.details.purchasePaidTxId; delete invoice.details.purchasePaidAt; } return; }
            const pay=state.transactions.find(x=>x.id==payId && x.type==='دفع'), oldAmount=Number(invoice.details?.sellerCredit||0);
            if(pay) {
                const seller=state.contacts.find(x=>x.id==pay.contactId); if(seller){ seller.balance-=oldAmount; await dbSave('contacts',seller); }
                const ids=(pay.details?.sourceInvoiceIds||[]).filter(x=>x!=invoice.id), newAmount=Math.max(0,Number(pay.amount||0)-oldAmount);
                if(ids.length===0 || newAmount<=0.0000001){ state.transactions=state.transactions.filter(x=>x.id!=pay.id); await dbDelete('transactions',pay.id); }
                else { pay.amount=newAmount; pay.details={...(pay.details||{}),sourceInvoiceIds:ids}; await dbSave('transactions',pay); }
            }
            delete invoice.details.purchasePaid; delete invoice.details.purchasePaidTxId; delete invoice.details.purchasePaidAt;
        }
        async function restoreInvoicesForPayment(pay) {
            for(const id of (pay?.details?.sourceInvoiceIds||[])) { const inv=state.transactions.find(x=>x.id==id&&x.type==='فاتورة'); if(inv&&inv.details?.purchasePaidTxId==pay.id){ delete inv.details.purchasePaid; delete inv.details.purchasePaidTxId; delete inv.details.purchasePaidAt; await dbSave('transactions',inv); } }
        }

        function openEdit(id, type) {
            window.editId = id; window.editType = type; const modal = document.getElementById('edit-modal'), content = document.getElementById('modal-content');
            const actions = modal.querySelector('.modal-box > div:last-child'); if(actions) actions.innerHTML = `<button class="btn btn-success" style="flex:1" onclick="saveModal()">حفظ</button><button class="btn btn-danger" style="flex:1" onclick="closeModal()">إلغاء</button>`; modal.querySelector('.modal-box').style.width='420px';
            if(type==='contact') {
                const c = id ? state.contacts.find(x=>x.id===id) : { name:'', phone:'', address:'', openingBal:0 }; document.getElementById('modal-title').innerText = id ? 'تعديل اسم' : 'إضافة اسم';
                content.innerHTML = `<label>الاسم</label><input id="e-c-name" value="${c.name}"><label>الهاتف</label><input id="e-c-phone" value="${c.phone||''}"><label>العنوان</label><input id="e-c-address" value="${c.address||''}"><label>افتتاحي</label><input type="number" id="e-c-open" value="${c.openingBal}">`;
            } else if(type==='tx') {
                const t = state.transactions.find(x=>x.id===id); if(!t) return; if(t.type==='دفع' && t.details?.sourceInvoiceIds?.length) { alert('واصل بواسطة الفاتورة مرتبط بالفواتير. عدّل الفاتورة نفسها ليتم تحديث الواصل بصورة صحيحة.'); return; } document.getElementById('modal-title').innerText = 'تعديل العملية';
                const txDate = String(t.date || '').split('T')[0] || new Date().toLocaleDateString('en-CA');
                if(t.type==='فاتورة') {
                    const b = state.contacts.find(x=>x.id===t.contactId), s = state.contacts.find(x=>x.id===t.secondaryId);
                    if(!b || !s) return alert('تعذر العثور على اسم المشتري أو البائع لهذه الفاتورة.');
                    content.innerHTML = `<label>التاريخ</label><input type="date" id="e-date" value="${txDate}"><label>العدد</label><input type="number" id="e-qty" value="${t.details.tQty}"><label>السعر</label><input type="number" id="e-price" value="${(t.details.raw/t.details.tQty).toFixed(2)}"><label>المشتري</label><input list="global-contacts-list" id="e-buyer" value="${b.name}" oninput="autoCompleteName(event)"><label>البائع</label><input list="global-contacts-list" id="e-seller" value="${s.name}" oninput="autoCompleteName(event)">`;
                } else {
                    const c = state.contacts.find(x=>x.id===t.contactId); if(!c) return alert('تعذر العثور على الاسم المرتبط بهذه المعاملة.');
                    content.innerHTML = `<label>التاريخ</label><input type="date" id="e-date" value="${txDate}"><label>الاسم</label><input list="global-contacts-list" id="e-tx-name" value="${c.name}" oninput="autoCompleteName(event)"><label>المبلغ</label><input type="number" id="e-amt" value="${t.amount}"><label>ملاحظات</label><input type="text" id="e-note" value="${t.details?.notes||''}">`;
                }
            } modal.classList.remove('hidden');
        }

        async function saveModal() {
            let sn, sf, st; const isSt = (state.activeTab==='statement');
            if(isSt){ sn=document.getElementById('st-search').value; sf=document.getElementById('st-from').value; st=document.getElementById('st-to').value; }
            if(window.editType==='contact') {
                const n = document.getElementById('e-c-name').value.trim(), p = document.getElementById('e-c-phone').value, a = document.getElementById('e-c-address').value, o = parseFloat(document.getElementById('e-c-open').value)||0; if(!n) return;
                const exists = state.contacts.find(x => x.name.trim() === n && x.id !== window.editId); if(exists) return alert('الاسم موجود!');
                if(window.editId) { const c = state.contacts.find(x=>x.id===window.editId); c.balance += (o-c.openingBal); c.name=n; c.phone=p; c.address=a; c.openingBal=o; await dbSave("contacts", c); }
                else { const newC = {id:Date.now(), name:n, phone:p, address:a, openingBal:o, balance:o}; state.contacts.push(newC); await dbSave("contacts", newC); }
            } else {
                const t = state.transactions.find(x=>x.id===window.editId);
                if(t.type==='فاتورة') {
                    const nQ=parseFloat(document.getElementById('e-qty').value), nP=parseFloat(document.getElementById('e-price').value), nBN=document.getElementById('e-buyer').value.trim(), nSN=document.getElementById('e-seller').value.trim();
                    if(!(nQ>0) || !(nP>0) || !nBN || !nSN) return alert('أدخل بيانات صحيحة');
                    const oldB=state.contacts.find(x=>x.id==t.contactId), oldS=state.contacts.find(x=>x.id==t.secondaryId);
                    if(!oldB || !oldS) return alert('تعذر العثور على الأسماء المرتبطة بهذه الفاتورة.');
                    if(t.details?.purchasePaid) await detachInvoicePayment(t);
                    oldB.balance-=t.amount; oldS.balance+=t.details.sellerCredit;
                    const newB=await findOrCreateC(nBN), newS=await findOrCreateC(nSN), sett=state.settings, nR=nQ*nP;
                    const nFB=nR+(nQ*sett.buyerFee), nFS=nR-(nQ*sett.sellerDisc)-(nR*(sett.p1/100))-((nR-(nR*(sett.p1/100)))*(sett.p2/100));
                    const pickedDate=document.getElementById('e-date').value||String(t.date).split('T')[0], oldTime=String(t.date).split('T')[1]||new Date().toTimeString().slice(0,8);
                    t.contactId=newB.id; t.secondaryId=newS.id; t.date=pickedDate+'T'+oldTime; t.amount=nFB; t.details={...t.details, tQty:nQ, raw:nR, sellerCredit:nFS}; newB.balance+=nFB; newS.balance-=nFS;
                    await dbSave("transactions", t); await dbSave("contacts", newB); await dbSave("contacts", newS);
                    if(oldB.id !== newB.id) await dbSave("contacts", oldB); if(oldS.id !== newS.id) await dbSave("contacts", oldS);
                } else {
                    if(t.type==='دفع' && t.details?.sourceInvoiceIds?.length) return alert('واصل بواسطة الفاتورة مرتبط بالفواتير ولا يعدل كسند مستقل.');
                    const nA=parseFloat(document.getElementById('e-amt').value), nName=document.getElementById('e-tx-name').value.trim(); if(!(nA>0) || !nName) return alert('أدخل بيانات صحيحة');
                    const oldC=state.contacts.find(x=>x.id==t.contactId); if(!oldC) return alert('تعذر العثور على الاسم المرتبط بهذه المعاملة.');
                    if(t.type==='قبض') oldC.balance+=t.amount; else oldC.balance-=t.amount;
                    const newC=await findOrCreateC(nName), pickedDate=document.getElementById('e-date').value||String(t.date).split('T')[0], oldTime=String(t.date).split('T')[1]||new Date().toTimeString().slice(0,8);
                    t.contactId=newC.id; t.date=pickedDate+'T'+oldTime; t.amount=nA; t.details=t.details||{}; t.details.notes=document.getElementById('e-note').value;
                    if(t.type==='قبض') newC.balance-=nA; else newC.balance+=nA;
                    await dbSave("transactions", t); await dbSave("contacts", newC); if(oldC.id!==newC.id) await dbSave("contacts", oldC);
                }
            } closeModal(); renderPage();
            if(isSt){ document.getElementById('st-search').value=sn; document.getElementById('st-from').value=sf; document.getElementById('st-to').value=st; drawSt(); }
        }


        async function deleteStatementDetail(id, date, kind, contactId) {
            if(!confirm('حذف العملية؟')) return;
            const t = state.transactions.find(x=>x.id==id); if(!t) return;
            if(t.type==='فاتورة') { if(t.details?.purchasePaid) await detachInvoicePayment(t); const b=state.contacts.find(x=>x.id==t.contactId), s=state.contacts.find(x=>x.id==t.secondaryId); b.balance-=t.amount; s.balance+=t.details.sellerCredit; await dbSave('contacts',b); await dbSave('contacts',s); }
            else { if(t.type==='دفع' && t.details?.sourceInvoiceIds?.length) await restoreInvoicesForPayment(t); const c=state.contacts.find(x=>x.id==t.contactId); if(t.type==='قبض') c.balance+=t.amount; else c.balance-=t.amount; await dbSave('contacts',c); }
            state.transactions = state.transactions.filter(x=>x.id!=id);
            await new Promise(r=>{ const q=db.transaction('transactions','readwrite'); q.objectStore('transactions').delete(id); q.oncomplete=()=>{ scheduleCloudSync(); r(); }; });
            drawSt();
            const remains=state.transactions.some(x=>(x.contactId===contactId||x.secondaryId===contactId)&&x.date.startsWith(date)&&statementMoveKind(x,state.contacts.find(c=>c.id===contactId))===kind);
            if(remains) openStatementGroupDetails(date,kind,contactId); else closeModal();
        }

        async function delTx(id) {
            if(!confirm('حذف العملية؟')) return; const t=state.transactions.find(x=>x.id==id); if(!t) return;
            if(t.type==='فاتورة'){ if(t.details?.purchasePaid) await detachInvoicePayment(t); const b=state.contacts.find(x=>x.id==t.contactId),s=state.contacts.find(x=>x.id==t.secondaryId); b.balance-=t.amount; s.balance+=t.details.sellerCredit; await dbSave('contacts',b); await dbSave('contacts',s); }
            else { if(t.type==='دفع'&&t.details?.sourceInvoiceIds?.length) await restoreInvoicesForPayment(t); const c=state.contacts.find(x=>x.id==t.contactId); if(t.type==='قبض') c.balance+=t.amount; else c.balance-=t.amount; await dbSave('contacts',c); }
            state.transactions=state.transactions.filter(x=>x.id!=id); await dbDelete('transactions',id); renderPage();
        }

        async function delC(id) { 
            const hasTx = state.transactions.some(t=>t.contactId===id||t.secondaryId===id);
            if(hasTx) { alert('لا يمكن حذف هذا الاسم لأنه مرتبط بمعاملات. احذف معاملاته أولاً حتى تبقى الأرصدة صحيحة.'); return; }
            if(!confirm('هل أنت متأكد من حذف الاسم؟')) return;
            state.contacts=state.contacts.filter(c=>c.id!==id);
            await dbDelete('contacts',id); renderPage();
        }

        function closeModal() { document.getElementById('edit-modal').classList.add('hidden'); window.editId=null; window.editType=null; }

        async function findOrCreateC(n) { 
            let c = state.contacts.find(x=>x.name.trim()===n.trim()); 
            if(!c) { c={id:Date.now()+Math.random(), name:n.trim(), balance:0, address:'', openingBal:0}; state.contacts.push(c); await dbSave("contacts", c); } 
            return c; 
        }
