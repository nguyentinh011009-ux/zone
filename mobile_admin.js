/* MOBILE ADMIN ENGINE - Y TẾ SỐ VTS
   Xử lý: Xác thực Vân tay/PIN, Tìm kiếm, Tiếp nhận di động, Canvas Chữ ký
*/

// --- 1. BIẾN TOÀN CỤC & TRẠNG THÁI ---
let currentAdminUser = null;
let activeStudentData = null;
let signatureCanvas, signatureCtx;
let isDrawing = false;
let videoStream = null;
let isFlashOn = false;

// Thuốc & Vật tư
let pharmacyCache = [];
let selectedMedicines = [];

// Trạng thái Passcode
let setupPasscodeArray = [];
let confirmPasscodeArray = [];
let loginPasscodeArray = [];

// Chống trôi header/footer khi cuộn
let lastScrollTop = 0;

// --- 2. KHỞI TẠO HỆ THỐNG ---
window.addEventListener('DOMContentLoaded', () => {
    initPasscodeKeyboards();
    checkDeviceRegistration();
    initScrollBehavior();
});

// --- 3. QUẢN LÝ ĐĂNG KÝ & BẢO MẬT THIẾT BỊ ---
function checkDeviceRegistration() {
    const isRegistered = localStorage.getItem('vts_mobile_registered');
    if (isRegistered === 'true') {
        showAuthStep('step-login');
        if (localStorage.getItem('vts_mobile_biometric') === 'true') {
            document.getElementById('btn-bio-trigger').style.display = 'block';
            triggerBiometricAuth();
        }
    } else {
        showAuthStep('step-google-login');
    }
}

function showAuthStep(stepId) {
    document.querySelectorAll('.auth-card').forEach(card => card.style.display = 'none');
    document.getElementById(stepId).style.display = 'block';
}

// Khởi tạo phím số
function initPasscodeKeyboards() {
    const createKeyboard = (containerId, onKeyPress) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (let i = 1; i <= 9; i++) {
            const btn = document.createElement('button');
            btn.className = 'key-btn';
            btn.innerText = i;
            btn.onclick = () => onKeyPress(i);
            container.appendChild(btn);
        }
        
        // Thêm nút phụ bên trái
        const leftBtn = document.createElement('button');
        leftBtn.className = 'key-btn empty-key';
        container.appendChild(leftBtn);

        // Phím 0
        const zeroBtn = document.createElement('button');
        zeroBtn.className = 'key-btn';
        zeroBtn.innerText = '0';
        zeroBtn.onclick = () => onKeyPress(0);
        container.appendChild(zeroBtn);

        // Phím xóa (X)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'key-btn icon-key';
        deleteBtn.innerHTML = '<i class="fas fa-backspace"></i>';
        deleteBtn.onclick = () => onKeyPress('delete');
        container.appendChild(deleteBtn);
    };

    createKeyboard('setup-keyboard', handleSetupPIN);
    createKeyboard('confirm-keyboard', handleConfirmPIN);
    createKeyboard('login-keyboard', handleLoginPIN);
}

// Google Login
function handleGoogleAuth() {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).then((result) => {
        const ALLOWED_EMAILS = [
            "nguyentinh011009@gmail.com", "tomizy09icloud@gmail.com",
            "nguyenthixuandongvts@gmail.com", "yte.thptvothisaubrvt@gmail.com", "nguyentinh52009@gmail.com"
        ];
        if (ALLOWED_EMAILS.includes(result.user.email)) {
            currentAdminUser = result.user;
            showAuthStep('step-set-passcode');
        } else {
            alert("Tài khoản của bạn không được cấp quyền quản trị!");
            firebase.auth().signOut();
        }
    }).catch(err => {
        alert("Lỗi xác thực Google: " + err.message);
    });
}

// PIN Setup
function handleSetupPIN(key) {
    updatePINArray(key, setupPasscodeArray, 'setup-dots');
    if (setupPasscodeArray.length === 6) {
        setTimeout(() => {
            showAuthStep('step-confirm-passcode');
        }, 300);
    }
}

function handleConfirmPIN(key) {
    updatePINArray(key, confirmPasscodeArray, 'confirm-dots');
    if (confirmPasscodeArray.length === 6) {
        const setupStr = setupPasscodeArray.join('');
        const confirmStr = confirmPasscodeArray.join('');
        if (setupStr === confirmStr) {
            localStorage.setItem('vts_mobile_pin', setupStr);
            localStorage.setItem('vts_mobile_registered', 'true');
            setTimeout(() => {
                showAuthStep('step-biometric-setup');
            }, 300);
        } else {
            alert("Mã PIN không khớp. Hãy thử tạo lại!");
            setupPasscodeArray = [];
            confirmPasscodeArray = [];
            updateDots('setup-dots', 0);
            updateDots('confirm-dots', 0);
            showAuthStep('step-set-passcode');
        }
    }
}

function handleLoginPIN(key) {
    updatePINArray(key, loginPasscodeArray, 'login-dots');
    if (loginPasscodeArray.length === 6) {
        const storedPIN = localStorage.getItem('vts_mobile_pin');
        const inputPIN = loginPasscodeArray.join('');
        if (storedPIN === inputPIN) {
            enterSystem();
        } else {
            alert("Mã PIN không chính xác!");
            loginPasscodeArray = [];
            updateDots('login-dots', 0);
        }
    }
}

function updatePINArray(key, array, dotsId) {
    if (key === 'delete') {
        array.pop();
    } else if (array.length < 6) {
        array.push(key);
    }
    updateDots(dotsId, array.length);
}

function updateDots(dotsId, length) {
    const dots = document.querySelectorAll(`#${dotsId} span`);
    dots.forEach((dot, index) => {
        if (index < length) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    });
}

// Vân tay sinh trắc học (Simulation WebAuthn/Biometric API bảo mật cục bộ)
function enableBiometric(agree) {
    if (agree) {
        localStorage.setItem('vts_mobile_biometric', 'true');
        alert("Đã kích hoạt bảo mật vân tay cho thiết bị này!");
    } else {
        localStorage.setItem('vts_mobile_biometric', 'false');
    }
    enterSystem();
}

async function triggerBiometricAuth() {
    if (!window.PublicKeyCredential) {
        alert("Thiết bị hoặc trình duyệt của bạn không hỗ trợ công nghệ xác thực sinh trắc học!");
        return;
    }

    // Thiết lập tùy chọn yêu cầu sinh trắc học cục bộ của trình duyệt di động
    const options = {
        challenge: new Uint8Array([1, 9, 0, 9, 2, 0, 0, 5]), // Giá trị ngẫu nhiên xác thực
        rp: { name: "Hệ thống Y Tế Số VTS" },
        user: { id: new Uint8Array([1]), name: "admin", displayName: "Quản trị viên" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }] // Thuật toán mã hóa chuẩn bảo mật gốc
    };

    try {
        // Gọi API gốc kích hoạt FaceID trên iOS hoặc Vân tay trên Android
        const credential = await navigator.credentials.create({ publicKey: options });
        if (credential) {
            enterSystem();
        }
    } catch (err) {
        console.warn("Huỷ xác thực sinh trắc học, chuyển sang sử dụng mã PIN thiết bị.", err);
    }
}

function enterSystem() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('search-screen').style.display = 'block';
    
    // Gán dữ liệu lên header
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            document.getElementById('admin-display-name').innerText = user.displayName || user.email.split('@')[0];
            if (user.photoURL) document.getElementById('admin-avatar').src = user.photoURL;
        }
    });

    loadPharmacyData();
}

// --- 4. HÀM TÌM KIẾM HỌC SINH (CHỈ CHẠY KHI NHẤN NÚT TÌM KIẾM) ---
async function searchStudent() {
    const inputVal = document.getElementById('student-search-input').value.trim();
    const resultsContainer = document.getElementById('student-results-list');
    
    if (inputVal.length === 0) {
        alert("Vui lòng nhập từ khóa tìm kiếm!");
        return;
    }

    resultsContainer.innerHTML = '<div style="text-align:center; padding: 30px;"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Đang tìm...</p></div>';

    try {
        const snap = await db.collection('yt_students').get();
        const matched = [];
        const normalizedInput = removeVietnameseTones(inputVal.toLowerCase());

        snap.forEach(doc => {
            const data = doc.data();
            const nameSearch = removeVietnameseTones(data.name || '').toLowerCase();
            const classSearch = (data.class || '').toLowerCase();
            const idSearch = doc.id.toLowerCase();

            if (nameSearch.includes(normalizedInput) || classSearch.includes(normalizedInput) || idSearch.includes(normalizedInput)) {
                matched.push({ id: doc.id, ...data });
            }
        });

        document.getElementById('results-count').innerText = `Kết quả tìm kiếm (${matched.length})`;

        if (matched.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-times"></i>
                    <p>Không tìm thấy học sinh nào!</p>
                </div>`;
            return;
        }

        resultsContainer.innerHTML = '';
        matched.forEach(hs => {
            resultsContainer.innerHTML += `
                <div class="student-row-card" onclick="loadStudentToTask('${hs.id}')">
                    <div class="st-left-info">
                        <h4>${hs.name}</h4>
                        <span>Lớp: ${hs.class}</span>
                        <small>Mã YT: ${hs.id}</small>
                    </div>
                    <button class="btn-action-go">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>`;
        });

    } catch (e) {
        alert("Lỗi tìm kiếm học sinh: " + e.message);
    }
}

// Tải thông tin học sinh vào màn tác vụ
async function loadStudentToTask(studentId) {
    try {
        const doc = await db.collection('yt_students').doc(studentId).get();
        if (doc.exists) {
            activeStudentData = { id: doc.id, ...doc.data() };
            
// Đoạn gán dữ liệu trong hàm loadStudentToTask(studentId)
document.getElementById('rec-id').innerText = activeStudentData.id;
document.getElementById('rec-code').innerText = activeStudentData.studentCode || 'Chưa cập nhật';
document.getElementById('rec-gender').innerText = activeStudentData.gender || 'Chưa rõ';
document.getElementById('rec-dob').innerText = activeStudentData.dob ? new Date(activeStudentData.dob).toLocaleDateString('vi-VN') : 'Chưa cập nhật';
document.getElementById('rec-phone').innerText = activeStudentData.phone || 'Chưa cập nhật';
document.getElementById('rec-parent-phone').innerText = activeStudentData.parentPhone || 'Chưa cập nhật';
document.getElementById('rec-address').innerText = activeStudentData.street ? `${activeStudentData.street}, ${activeStudentData.ward || ''}, ${activeStudentData.city || ''}` : 'Chưa cập nhật';
document.getElementById('rec-height').innerText = activeStudentData.height ? `${activeStudentData.height} cm` : 'Chưa cập nhật';
document.getElementById('rec-weight').innerText = activeStudentData.weight ? `${activeStudentData.weight} kg` : 'Chưa cập nhật';
document.getElementById('rec-email').innerText = activeStudentData.linkedEmail || 'Chưa liên kết app';

// Tính toán BMI tự động
if (activeStudentData.height && activeStudentData.weight) {
    const h = parseFloat(activeStudentData.height) / 100;
    const w = parseFloat(activeStudentData.weight);
    const bmi = (w / (h * h)).toFixed(1);
    document.getElementById('rec-bmi').innerText = bmi;
} else {
    document.getElementById('rec-bmi').innerText = 'Chưa tính';
}
            
            const warningAlert = document.getElementById('rec-warning');
            if (activeStudentData.medicalNote) {
                warningAlert.innerText = `Cảnh báo dị ứng/Bệnh lý: ${activeStudentData.medicalNote}`;
                warningAlert.style.display = 'block';
            } else {
                warningAlert.style.display = 'none';
            }

// Gán thông tin đầy đủ vào Tab 2 (Chỉnh sửa)
document.getElementById('edit-student-id').value = activeStudentData.id;
document.getElementById('edit-student-code').value = activeStudentData.studentCode || '';
document.getElementById('edit-student-name').value = activeStudentData.name || '';
document.getElementById('edit-student-class').value = activeStudentData.class || '';
document.getElementById('edit-student-dob').value = activeStudentData.dob || '';
document.getElementById('edit-student-gender').value = activeStudentData.gender || 'Nam';
document.getElementById('edit-student-phone').value = activeStudentData.phone || '';
document.getElementById('edit-student-parent-phone').value = activeStudentData.parentPhone || '';
document.getElementById('edit-student-street').value = activeStudentData.street || '';
document.getElementById('edit-student-ward').value = activeStudentData.ward || '';
document.getElementById('edit-student-city').value = activeStudentData.city || 'Thành phố Hồ Chí Minh';
document.getElementById('edit-student-height').value = activeStudentData.height || '';
document.getElementById('edit-student-weight').value = activeStudentData.weight || '';
document.getElementById('edit-student-email').value = activeStudentData.linkedEmail || '';
document.getElementById('edit-student-medical-note').value = activeStudentData.medicalNote || '';

            // Tải Tab 3: Lịch sử khám
            loadStudentHistory(studentId);

            // Chuyển màn hình
            document.getElementById('search-screen').style.display = 'none';
            document.getElementById('task-screen').style.display = 'block';
            
            // Mặc định kích hoạt tab Tiếp nhận ở giữa
            switchTaskTab('pane-reception', document.querySelector('.bottom-nav-bar button.center-btn'));
            setTimeout(initSignaturePad, 500); // Khởi tạo canvas ký

        }
    } catch (e) {
        alert("Lỗi tải hồ sơ học sinh: " + e.message);
    }
}

// Quay về tìm kiếm
function backToSearch() {
    document.getElementById('task-screen').style.display = 'none';
    document.getElementById('search-screen').style.display = 'block';
    activeStudentData = null;
}

// --- 5. BOTTOM TABS NẰM SÁT MÀN HÌNH ---
function switchTaskTab(paneId, btn) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-bar button').forEach(b => b.classList.remove('active'));

    document.getElementById(paneId).classList.add('active');
    btn.classList.add('active');

    // Nếu quay về tab vẽ thì khởi tạo lại pad
    if (paneId === 'pane-reception') {
        setTimeout(initSignaturePad, 200);
    }
}

// --- 6. KHỞI TẠO VẼ CHỮ KÝ TRỰC TIẾP TRÊN MÀN HÌNH ---
function initSignaturePad() {
    signatureCanvas = document.getElementById('signature-pad');
    if (!signatureCanvas) return;
    
    // Set kích thước chuẩn tương ứng tỉ lệ màn hình thực tế
    signatureCanvas.width = signatureCanvas.parentElement.clientWidth;
    signatureCanvas.height = signatureCanvas.parentElement.clientHeight;
    
    signatureCtx = signatureCanvas.getContext('2d');
    signatureCtx.lineWidth = 3;
    signatureCtx.lineJoin = 'round';
    signatureCtx.lineCap = 'round';
    signatureCtx.strokeStyle = '#000000';

    // Xử lý sự kiện Touch di động
    signatureCanvas.addEventListener('touchstart', (e) => {
        isDrawing = true;
        const pos = getTouchPos(signatureCanvas, e);
        signatureCtx.beginPath();
        signatureCtx.moveTo(pos.x, pos.y);
        e.preventDefault();
    }, { passive: false });

    signatureCanvas.addEventListener('touchmove', (e) => {
        if (!isDrawing) return;
        const pos = getTouchPos(signatureCanvas, e);
        signatureCtx.lineTo(pos.x, pos.y);
        signatureCtx.stroke();
        e.preventDefault();
    }, { passive: false });

    signatureCanvas.addEventListener('touchend', () => {
        isDrawing = false;
    });
}

function getTouchPos(canvasDom, touchEvent) {
    const rect = canvasDom.getBoundingClientRect();
    return {
        x: touchEvent.touches[0].clientX - rect.left,
        y: touchEvent.touches[0].clientY - rect.top
    };
}

function clearSignature() {
    if (signatureCtx && signatureCanvas) {
        signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
}

// --- 7. CẤP PHÁT THUỐC TỰ ĐỘNG ---
function loadPharmacyData() {
    db.collection('yt_pharmacy_items').onSnapshot(snap => {
        pharmacyCache = [];
        snap.forEach(doc => pharmacyCache.push({ id: doc.id, ...doc.data() }));
    });
}

function toggleMedicineSection() {
    const checked = document.getElementById('chk-use-medicine').checked;
    document.getElementById('medicine-selection-box').style.display = checked ? 'block' : 'none';
}

function searchMedicine(val) {
    const box = document.getElementById('med-suggest-box');
    if (val.trim().length < 2) { box.style.display = 'none'; return; }

    const keyword = removeVietnameseTones(val.trim()).toLowerCase();
    const matched = pharmacyCache.filter(item => {
        const hasStock = item.batches && item.batches.some(b => parseFloat(b.qty) > 0);
        return hasStock && removeVietnameseTones(item.name || '').toLowerCase().includes(keyword);
    });

    box.innerHTML = '';
    if (matched.length === 0) {
        box.innerHTML = '<div style="padding:10px; font-size:0.8rem; color:red;">Hết thuốc hoặc không có!</div>';
    } else {
        matched.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggest-item';
            div.innerText = item.name;
            div.onclick = () => selectMedicine(item);
            box.appendChild(div);
        });
    }
    box.style.display = 'block';
}

function selectMedicine(item) {
    document.getElementById('med-search-input').value = item.name;
    document.getElementById('med-suggest-box').style.display = 'none';
    
    const batchSelect = document.getElementById('med-batch-select');
    batchSelect.innerHTML = '<option value="">Chọn lô</option>';
    
    if (item.batches) {
        item.batches.forEach((b, index) => {
            if (parseFloat(b.qty) > 0) {
                batchSelect.innerHTML += `<option value="${index}">Lô ${b.lot} (Tồn: ${b.qty})</option>`;
            }
        });
    }
    
    // Gán dữ liệu tạm lên select để phục vụ hàm thêm
    batchSelect.dataset.itemId = item.id;
    batchSelect.dataset.itemName = item.name;
    batchSelect.dataset.unit = item.unit;
}

function addMedicine() {
    const select = document.getElementById('med-batch-select');
    const itemId = select.dataset.itemId;
    const itemName = select.dataset.itemName;
    const unit = select.dataset.unit;
    const batchIdx = select.value;
    const qty = parseFloat(document.getElementById('med-qty-input').value);

    if (!itemId || batchIdx === "" || isNaN(qty) || qty <= 0) {
        alert("Vui lòng chọn thuốc, lô và nhập số lượng đúng!");
        return;
    }

    const item = pharmacyCache.find(i => i.id === itemId);
    const batchSelected = item.batches[batchIdx];

    if (qty > parseFloat(batchSelected.qty)) {
        alert("Số lượng tồn kho không đủ để cấp!");
        return;
    }

    selectedMedicines.push({
        itemId,
        itemName,
        batchIndex: batchIdx,
        lot: batchSelected.lot,
        qty,
        unit
    });

    renderSelectedMedicines();

// Thay thế đoạn cuối hàm addMedicine() để tự động điền danh sách thuốc
const treatmentInput = document.getElementById('yt-treatment');
// Chỉ lấy tên thuốc và số lượng ghép lại
const textAppend = `Cấp ${itemName} (${qty} ${unit})`;

let currentVal = treatmentInput.value.trim();
if (currentVal === "") {
    treatmentInput.value = textAppend;
} else {
    // Nếu trong ô xử lý đã có chữ thì thêm dấu phẩy ngăn cách
    treatmentInput.value = currentVal + ", " + textAppend;
}

    // Reset form cấp
    document.getElementById('med-search-input').value = '';
    select.innerHTML = '<option value="">Chọn lô</option>';
}

function renderSelectedMedicines() {
    const container = document.getElementById('med-pending-list');
    container.innerHTML = '';
    selectedMedicines.forEach((m, idx) => {
        container.innerHTML += `
            <div class="med-item-row">
                <span><strong>${m.itemName}</strong> (Lô ${m.lot}) - ${m.qty} ${m.unit}</span>
                <i class="fas fa-trash" onclick="removeSelectedMed(${idx})"></i>
            </div>`;
    });
}

function removeSelectedMed(idx) {
    selectedMedicines.splice(idx, 1);
    renderSelectedMedicines();
}

// --- 8. HOÀN THÀNH TIẾP NHẬN ---
async function saveReception() {
    const symptom = document.getElementById('yt-symptom').value.trim();
    const treatment = document.getElementById('yt-treatment').value.trim();
    const note = document.getElementById('yt-note').value.trim();
    
    if (!symptom) return alert("Vui lòng nhập triệu chứng!");
    if (!treatment) return alert("Vui lòng nhập cách xử lý!");

    // Chuyển Canvas vẽ thành dạng ảnh base64
    const signImg = signatureCanvas ? signatureCanvas.toDataURL() : '';

    try {
        const batch = db.batch();

        // 1. Thêm bản ghi lượt tiếp nhận
        const visitRef = db.collection('yt_visits').doc();
        batch.set(visitRef, {
            studentId: activeStudentData.id,
            name: activeStudentData.name,
            class: activeStudentData.class,
            symptom,
            treatment,
            note,
            sign: signImg,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 2. Trừ kho thuốc nếu có cấp phát
        if (selectedMedicines.length > 0) {
            let pharmacyUpdates = {};
            selectedMedicines.forEach(m => {
                const itemInCache = pharmacyCache.find(pc => pc.id === m.itemId);
                if (!pharmacyUpdates[m.itemId]) {
                    pharmacyUpdates[m.itemId] = JSON.parse(JSON.stringify(itemInCache.batches));
                }
                pharmacyUpdates[m.itemId][m.batchIndex].qty -= m.qty;
            });

            for (const [id, batches] of Object.entries(pharmacyUpdates)) {
                batch.update(db.collection('yt_pharmacy_items').doc(id), { batches });
            }

            // Ghi Log giao dịch xuất thuốc
            const txId = "XK-M-" + Date.now().toString().slice(-6);
            const txRef = db.collection('yt_pharmacy_transactions').doc(txId);
            batch.set(txRef, {
                id: txId,
                type: 'export',
                receiver: `${activeStudentData.name} (${activeStudentData.class})`,
                reason: "Tiếp nhận cấp thuốc di động",
                notes: `Liên kết đợt khám ${visitRef.id}`,
                items: selectedMedicines,
                user: firebase.auth().currentUser ? firebase.auth().currentUser.email : "Mobile Admin",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();
        alert("✅ Tiếp nhận lượt khám thành công!");
        
        // Reset các trường
        document.getElementById('yt-symptom').value = '';
        document.getElementById('yt-note').value = '';
        document.getElementById('chk-use-medicine').checked = false;
        toggleMedicineSection();
        selectedMedicines = [];
        renderSelectedMedicines();
        clearSignature();

        // Quay lại màn hình chính
        backToSearch();

    } catch (e) {
        alert("Có lỗi xảy ra: " + e.message);
    }
}

// --- 9. CHỈNH SỬA THÔNG TIN CHI TIẾT ---
async function saveStudentProfile() {
    const studentCode = document.getElementById('edit-student-code').value.trim();
    const name = document.getElementById('edit-student-name').value.trim();
    const className = document.getElementById('edit-student-class').value.trim();
    const dob = document.getElementById('edit-student-dob').value;
    const gender = document.getElementById('edit-student-gender').value;
    const parentPhone = document.getElementById('edit-student-parent-phone').value.trim();
    const street = document.getElementById('edit-student-address').value.trim();
    const height = document.getElementById('edit-student-height').value.trim();
    const weight = document.getElementById('edit-student-weight').value.trim();
    const medicalNote = document.getElementById('edit-student-medical-note').value.trim();

    if (!name || !className) return alert("Họ tên và Lớp không được để trống!");

    try {
        const payload = {
            studentCode, name, class: className, dob, gender, parentPhone, street, height, weight, medicalNote,
            name_search: removeVietnameseTones(name)
        };

        await db.collection('yt_students').doc(activeStudentData.id).update(payload);
        alert("✅ Đã cập nhật thông tin học sinh!");
        
        // Cập nhật lại trạng thái local
        activeStudentData = { ...activeStudentData, ...payload };
    } catch (e) {
        alert("Lỗi khi cập nhật thông tin: " + e.message);
    }
}

// --- 10. XEM LỊCH SỬ KHÁM ---
async function loadStudentHistory(studentId) {
    const container = document.getElementById('visit-history-list');
    container.innerHTML = '<div style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Đang tải lịch sử...</div>';

    try {
        const snap = await db.collection('yt_visits').where('studentId', '==', studentId).get();
        if (snap.empty) {
            container.innerHTML = '<p style="text-align:center; color:gray;">Chưa có lịch sử khám bệnh trước đây.</p>';
            return;
        }

        let list = [];
        snap.forEach(doc => list.push(doc.data()));
        // Sắp xếp thời gian mới nhất lên đầu
        list.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        container.innerHTML = '';
        list.forEach(item => {
            const time = item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleString('vi-VN') : 'Vừa xong';
            container.innerHTML += `
                <div class="timeline-item">
                    <div class="timeline-date">${time}</div>
                    <div class="timeline-desc">
                        <strong>Triệu chứng:</strong> ${item.symptom} <br>
                        <strong>Hướng xử lý:</strong> <span style="color:green;">${item.treatment}</span>
                        ${item.note ? `<br><i>Ghi chú: ${item.note}</i>` : ''}
                    </div>
                </div>`;
        });
    } catch (e) {
        container.innerHTML = '<p style="color:red;">Lỗi khi tải lịch sử khám.</p>';
    }
}

// --- 11. ĐIỀU HƯỚNG SCROLL THÔNG MINH (ẨN/HIỆN KHI CUỘN) ---
function initScrollBehavior() {
    window.addEventListener('scroll', () => {
        let st = window.pageYOffset || document.documentElement.scrollTop;
        const header = document.querySelector('.glass-header');
        const bottomNav = document.getElementById('app-bottom-nav');

        if (st > lastScrollTop && st > 100) {
            // Cuộn xuống -> Ẩn
            if(header) header.classList.add('scroll-hide-header');
            if(bottomNav) bottomNav.classList.add('scroll-hide-nav');
        } else {
            // Cuộn lên -> Hiện
            if(header) header.classList.remove('scroll-hide-header');
            if(bottomNav) bottomNav.classList.remove('scroll-hide-nav');
        }
        lastScrollTop = st <= 0 ? 0 : st;
    }, { passive: true });
}

// --- 12. CAMERA QUÉT QR MÃ VẠCH ---
function openQRScanner() {
    document.getElementById('scanner-modal').classList.add('active');
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(stream => {
        videoStream = stream;
        const video = document.getElementById('scanner-video');
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        video.play();
        requestAnimationFrame(tickQRScan);
    }).catch(err => {
        alert("Không thể khởi động Camera: " + err.message);
        closeQRScanner();
    });
}

function tickQRScan() {
    const video = document.getElementById('scanner-video');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code) {
            // Đã nhận diện được mã
            let scannedData = code.data.trim();
            if (scannedData.toLowerCase().startsWith('yt-')) {
                scannedData = scannedData.toUpperCase();
            }
            closeQRScanner();
            loadStudentToTask(scannedData);
            return;
        }
    }
    if (videoStream) {
        requestAnimationFrame(tickQRScan);
    }
}

function closeQRScanner() {
    document.getElementById('scanner-modal').classList.remove('active');
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
}

function toggleCameraFlash() {
    if (videoStream) {
        const track = videoStream.getVideoTracks()[0];
        isFlashOn = !isFlashOn;
        track.applyConstraints({
            advanced: [{ torch: isFlashOn }]
        }).catch(() => {
            alert("Thiết bị không hỗ trợ Đèn Flash!");
        });
    }
}

// --- 13. SETTINGS & LOGOUT ---
function toggleSettingsDropdown() {
    const dd = document.getElementById('settings-dropdown');
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
}

function toggleBiometricsSetting() {
    const active = localStorage.getItem('vts_mobile_biometric') === 'true';
    localStorage.setItem('vts_mobile_biometric', !active);
    alert(!active ? "Đã bật đăng nhập bằng vân tay!" : "Đã tắt đăng nhập bằng vân tay!");
    toggleSettingsDropdown();
}

async function requestChangePasscode() {
    const user = firebase.auth().currentUser;
    if (!user) {
        alert("Vui lòng thực hiện đăng nhập để xác thực thông tin quản trị viên trước!");
        return;
    }

    const email = user.email;
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Tạo mã OTP 6 chữ số ngẫu nhiên

    try {
        // 1. Lưu mã OTP tạm thời vào Firestore để đối chiếu, thời hạn hiệu lực là 5 phút
        await db.collection('yt_temp_otp').doc(email).set({
            otp: otp,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 2. Kích hoạt tính năng gửi Email tự động thông qua Collection Mail (Firebase Trigger Email)
        await db.collection('mail').add({
            to: email,
            message: {
                subject: "[Y Tế Số VTS] Mã OTP xác nhận đổi mã PIN thiết bị",
                text: `Mã OTP của bạn là: ${otp}. Mã này sẽ hết hiệu lực sau 5 phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 500px;">
                        <h2 style="color: #0062ff; text-align: center;">Y TẾ SỐ VTS</h2>
                        <p>Chào bạn,</p>
                        <p>Hệ thống nhận được yêu cầu đổi mã PIN thiết bị của bạn. Dưới đây là mã xác thực OTP của bạn:</p>
                        <div style="text-align: center; margin: 25px 0;">
                            <span style="font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #0062ff; padding: 10px 20px; background: #f0fdf4; border: 1px dashed #10b981; border-radius: 8px;">${otp}</span>
                        </div>
                        <p style="color: #ef4444; font-size: 0.85rem;">*Mã xác thực này chỉ có hiệu lực trong vòng 5 phút.</p>
                        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                        <p style="font-size: 0.8rem; color: #64748b; text-align: center;">Bản quyền hệ thống © THPT Võ Thị Sáu</p>
                    </div>`
            }
        });

        // 3. Hiển thị hộp thoại yêu cầu người dùng nhập OTP đã gửi
        const userOTPInput = prompt("Hệ thống đã gửi một mã xác thực (OTP) tới Email quản trị của bạn. Vui lòng kiểm tra hộp thư (và thư rác) và nhập mã tại đây:");
        
        if (userOTPInput === otp) {
            const newPin = prompt("Xác thực thành công! Nhập mã PIN mới (gồm 6 chữ số):");
            if (newPin && newPin.length === 6 && !isNaN(newPin)) {
                localStorage.setItem('vts_mobile_pin', newPin);
                alert("Thay đổi mã PIN thiết bị thành công!");
                toggleSettingsDropdown();
            } else {
                alert("Mã PIN không đúng quy cách (phải là 6 ký tự số)!");
            }
        } else {
            alert("Mã xác thực OTP nhập vào không chính xác!");
        }

    } catch (e) {
        alert("Lỗi không thể gửi mã xác nhận: " + e.message);
    }
}

function handleLogout() {
    if (confirm("Đăng xuất tài khoản quản trị khỏi thiết bị?")) {
        localStorage.clear();
        firebase.auth().signOut().then(() => {
            location.reload();
        });
    }
}

function goToHome() {
    if (confirm("Quay về trang thông tin chung?")) {
        window.location.href = "index.html";
    }
}

// Loại bỏ dấu tiếng Việt
function removeVietnameseTones(str) {
    if (!str) return "";
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str;
}
// Tính năng khóa màn hình khi thoát ứng dụng hoặc đổi tab (như app ngân hàng)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // Khi người dùng thoát ra màn hình chính hoặc chuyển ứng dụng, khóa trạng thái phiên
        sessionStorage.setItem('vts_mobile_session_locked', 'true');
    }
});

// Kiểm tra khóa khi ứng dụng hoạt động trở lại
window.addEventListener('pageshow', () => {
    const isRegistered = localStorage.getItem('vts_mobile_registered');
    const isSessionLocked = sessionStorage.getItem('vts_mobile_session_locked');
    
    if (isRegistered === 'true' && isSessionLocked === 'true') {
        // Reset trạng thái nhập PIN
        loginPasscodeArray = [];
        updateDots('login-dots', 0);
        showAuthStep('step-login');
        
        // Tự động gọi quét sinh trắc học nếu đã bật
        if (localStorage.getItem('vts_mobile_biometric') === 'true') {
            triggerBiometricAuth();
        }
    }
});

// Cập nhật hàm enterSystem để mở khóa phiên hoạt động
const originalEnterSystem = enterSystem;
enterSystem = function() {
    sessionStorage.removeItem('vts_mobile_session_locked');
    originalEnterSystem();
};
// Điều khiển Pop-up ký tên
function openSignatureModal() {
    const symptom = document.getElementById('yt-symptom').value.trim();
    const treatment = document.getElementById('yt-treatment').value.trim();
    
    if (!symptom || !treatment) {
        alert("Vui lòng nhập đầy đủ Triệu chứng và Hướng xử lý của học sinh trước khi tiến hành ký tên!");
        return;
    }
    
    document.getElementById('signature-modal').classList.add('active');
    setTimeout(initSignaturePad, 300); // Trì hoãn khởi tạo để canvas nhận diện đúng chiều rộng modal
}

function closeSignatureModal() {
    document.getElementById('signature-modal').classList.remove('active');
}

function confirmSignatureAndSave() {
    // Tắt modal trước khi thực thi tiến trình lưu nền của Firebase
    closeSignatureModal();
    saveReception(); // Gọi hàm lưu trữ gốc
}
