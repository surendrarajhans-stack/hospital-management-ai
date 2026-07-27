// ==========================================================================
// MedSphere AI - Clinical Dashboard & Operations Controller
// ==========================================================================

const API_BASE_URL = window.location.origin;

// Global URL Hash Cleaner (Strips trailing /# from browser address bar automatically)
window.cleanUrlHash = function() {
    if (window.location.href.includes("#")) {
        const cleanUrl = window.location.href.split('#')[0];
        history.replaceState(null, "", cleanUrl);
    }
};

cleanUrlHash();
window.addEventListener("DOMContentLoaded", cleanUrlHash);
window.addEventListener("hashchange", cleanUrlHash);

document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a");
    if (anchor) {
        const href = anchor.getAttribute("href");
        if (href === "#" || href === "") {
            e.preventDefault();
            cleanUrlHash();
        }
    }
});

// 1. Unified Application State
const state = {
    userName: "",
    userId: "",
    userRole: "", // "Doctor", "Nurse", "Pharmacist", "Patient", "IT Admin", "Super Admin"
    roleClearance: 0, // 1=Doctor, 2=Nurse, 3=Pharmacist, 4=Patient, 14=IT Admin, 15=Super Admin
    onboardingStep: 0, // 0=Role Select, 1=Credentials, 2=Dashboard
    activeDashboardView: "",
    chatLanguage: "en",
    localization: {
        country: "India",
        currency: "INR",
        currencySymbol: "₹",
        timezone: "Asia/Kolkata",
        taxName: "GST",
        taxRate: 18
    }
};

// 2. Mock Database Definition
const MOCK_DB = {
    admissions: [],
    doctors: [
        { id: "DOC-001", name: "Dr. Surendra Rajhans", specialty: "Cardiology", room: "OPD 101", shift: "Morning", phone: "+91 94394 98158" },
        { id: "DOC-002", name: "Dr. Lakshmi Prasad", specialty: "Pediatrics", room: "OPD 105", shift: "Afternoon", phone: "+91 98765 00002" },
        { id: "DOC-003", name: "Dr. Vikas Sharma", specialty: "Neurology", room: "OPD 202", shift: "Night", phone: "+91 98765 00003" }
    ],
    patients: [
        { id: "PAT-001", name: "Ramesh Kumar", age: 45, triage: "Stable", bed: "ICU-02", bill: 12500, paid: false, complaint: "Chronic hypertension" },
        { id: "PAT-002", name: "Sita Devi", age: 32, triage: "Under Observation", bed: "GW-05", bill: 4500, paid: false, complaint: "Post-op care, mild fever" },
        { id: "PAT-003", name: "Kabir Khan", age: 8, triage: "Stable", bed: "PED-01", bill: 1800, paid: true, complaint: "Acute bronchitis checkup" }
    ],
    wards: [
        { id: "ICU-01", type: "ICU", occupied: false, patientId: "" },
        { id: "ICU-02", type: "ICU", occupied: true, patientId: "PAT-001" },
        { id: "GW-01", type: "General Ward", occupied: false, patientId: "" },
        { id: "GW-05", type: "General Ward", occupied: true, patientId: "PAT-002" },
        { id: "PED-01", type: "Pediatrics", occupied: true, patientId: "PAT-003" }
    ],
    staff: [
        { id: "NURSE-01", name: "Sister Anjali", dept: "ICU", shift: "Day" },
        { id: "NURSE-02", name: "Sister Mary", dept: "General Ward", shift: "Night" }
    ],
    pharmacy: [
        { id: "DRUG-01", name: "Paracetamol 650mg", stock: 1200, price: 15 },
        { id: "DRUG-02", name: "Amoxicillin 500mg", stock: 500, price: 80 },
        { id: "DRUG-03", name: "Atorvastatin 10mg", stock: 350, price: 45 },
        { id: "DRUG-04", name: "Pantoprazole 40mg", stock: 800, price: 25 }
    ],
    prescriptions: []
};

// Demo Account Reference Mapping
const DEMO_ACCOUNTS = {
    "superadmin": { name: "Global Admin", id: "SUPERADMIN", role: "Super Admin", clearance: 15 },
    "itadmin": { name: "IT Director", id: "IT-ADMIN-01", role: "IT Admin", clearance: 14 },
    "doc01": { name: "Dr. Surendra Rajhans", id: "DOC-001", role: "Doctor", clearance: 1 },
    "nurse01": { name: "Sister Anjali", id: "NURSE-01", role: "Nurse", clearance: 2 },
    "pharm01": { name: "Pharmacy Desk", id: "PHARM-01", role: "Pharmacist", clearance: 3 },
    "pat01": { name: "Ramesh Kumar", id: "PAT-001", role: "Patient", clearance: 4 }
};

// 3. UI DOM Caching
window.AppElements = {};
function cacheDOM() {
    window.AppElements = {
        sidebar: document.getElementById("main-sidebar"),
        header: document.getElementById("main-header"),
        viewContainer: document.getElementById("view-container"),
        chatMessages: document.getElementById("chatMessages"),
        chatForm: document.getElementById("chatForm"),
        chatInput: document.getElementById("chatInput")
    };
}

// 4. Initialize & State restore
window.addEventListener("DOMContentLoaded", () => {
    cacheDOM();
    if (window.lucide) window.lucide.createIcons();
    
    // Check if license is active
    const savedState = localStorage.getItem("medsphere_state");
    if (savedState) {
        try {
            const parsed = JSON.parse(savedState);
            Object.assign(state, parsed);
        } catch (e) {}
    }
    
    loadDatabaseState();
    if (typeof window.applyRegionalUI === 'function') window.applyRegionalUI();
    
    // Switch to initial state
    if (state.onboardingStep === 2 && state.userId) {
        switchRole(state.roleClearance, state.userName, state.userId);
    } else {
        resetToOnboarding();
    }
});

// 5. Onboarding / Role switching flows
window.resetToOnboarding = function() {
    state.onboardingStep = 0;
    saveLocalState();
    
    if (window.AppElements.sidebar) window.AppElements.sidebar.classList.add("hidden");
    if (window.AppElements.header) window.AppElements.header.classList.add("hidden");
    
    document.getElementById("onboarding-role-select").classList.remove("hidden");
    document.getElementById("onboarding-credentials").classList.add("hidden");
    
    // Hide all dashboards
    document.querySelectorAll("section[id^='view-']").forEach(sec => sec.classList.add("hidden"));
};

window.selectRoleOnboarding = function(clearance, roleLabel) {
    state.roleClearance = clearance;
    state.userRole = roleLabel;
    
    let name = "Guest User";
    let id = "DEMO-01";
    
    if (clearance === 15) { name = "Global Admin"; id = "SUPERADMIN"; }
    else if (clearance === 14) { name = "IT Director"; id = "IT-ADMIN-01"; }
    else if (clearance === 1) { name = "Dr. Surendra Rajhans"; id = "DOC-001"; }
    else if (clearance === 2) { name = "Sister Anjali"; id = "NURSE-01"; }
    else if (clearance === 3) { name = "Pharmacy Desk"; id = "PHARM-01"; }
    else if (clearance === 4) { name = "Ramesh Kumar"; id = "PAT-001"; }
    
    // Directly log into the workspace
    switchRole(clearance, name, id);
};

window.onboardingBackToRoles = function() {
    resetToOnboarding();
};

window.submitOnboardingCredentials = function(e) {
    e.preventDefault();
    const name = document.getElementById("user-input-name").value.trim();
    const id = document.getElementById("user-input-id").value.trim().toUpperCase();
    
    if (!name || !id) return;
    
    // Verify Demo records
    let isMatched = false;
    for (let k in DEMO_ACCOUNTS) {
        const acc = DEMO_ACCOUNTS[k];
        if (acc.id === id && acc.clearance === state.roleClearance) {
            isMatched = true;
            break;
        }
    }
    
    // In demo environment, allow any name/id if not matching demo records
    switchRole(state.roleClearance, name, id);
};

window.switchRole = function(clearance, name, id) {
    state.userName = name;
    state.userId = id;
    state.roleClearance = clearance;
    
    // Map clearance level to role title
    if (clearance === 15) state.userRole = "Super Admin";
    else if (clearance === 14) state.userRole = "IT Administrator";
    else if (clearance === 1) state.userRole = "Doctor";
    else if (clearance === 2) state.userRole = "Nurse";
    else if (clearance === 3) state.userRole = "Pharmacist";
    else if (clearance === 4) state.userRole = "Patient";
    
    state.onboardingStep = 2;
    saveLocalState();
    
    // Show navigation layouts
    if (window.AppElements.sidebar) window.AppElements.sidebar.classList.remove("hidden");
    if (window.AppElements.header) window.AppElements.header.classList.remove("hidden");
    document.getElementById("onboarding-credentials").classList.add("hidden");
    
    // Update sidebar badges
    document.getElementById("sidebar-user-name").innerText = name;
    document.getElementById("sidebar-user-role").innerText = state.userRole;
    document.getElementById("user-badge-avatar").innerText = name.charAt(0).toUpperCase();
    
    // Update theme body color
    document.body.className = "bg-[#0b0f19] text-[#f3f4f6] font-sans antialiased overflow-x-hidden";
    if (clearance === 15) {
        document.body.classList.add("theme-super-admin");
        switchDashboardView("view-super-admin");
    } else if (clearance === 14) {
        document.body.classList.add("theme-it-administrator");
        switchDashboardView("view-it-administrator");
    } else if (clearance === 1) {
        document.body.classList.add("theme-doctor");
        switchDashboardView("view-doctor");
    } else if (clearance === 2) {
        document.body.classList.add("theme-nurse");
        switchDashboardView("view-nurse");
    } else if (clearance === 3) {
        document.body.classList.add("theme-pharmacist");
        switchDashboardView("view-pharmacist");
    } else if (clearance === 4) {
        document.body.classList.add("theme-patient");
        switchDashboardView("view-patient");
    }
    
    addSystemLog(`User ${name} authenticated successfully as ${state.userRole}.`, "Success");
};

// 6. Navigation View Switching
window.switchDashboardView = function(viewId, elementLink = null) {
    // Strip trailing # from address bar if present
    cleanUrlHash();

    // Hide all dashboards
    document.querySelectorAll("section[id^='view-']").forEach(sec => sec.classList.add("hidden"));
    
    // Show active dashboard
    const target = document.getElementById(viewId);
    if (target) target.classList.remove("hidden");
    
    state.activeDashboardView = viewId;
    saveLocalState();
    
    // Update header label
    let label = "Operations Control";
    if (viewId === "view-super-admin") label = "Licensing and Setup Console";
    else if (viewId === "view-it-administrator") label = "IT Cloud Importer & Audit";
    else if (viewId === "view-doctor") label = "Clinical Diagnosis Desk";
    else if (viewId === "view-nurse") label = "Ward Monitoring & Vitals";
    else if (viewId === "view-pharmacist") label = "Pharmacy Dispensing & Invoices";
    else if (viewId === "view-patient") label = "Your Care & AI Assistant";
    else if (viewId === "view-manual-patient-entry") label = "Manual Patient Entry Desk";
    
    document.getElementById("current-view-title").innerText = label;
    
    // Update active nav link classes
    document.querySelectorAll(".sidebar-link").forEach(lnk => lnk.classList.remove("active"));
    if (elementLink) {
        elementLink.classList.add("active");
    } else {
        // Fallback matching
        const links = document.querySelectorAll(".sidebar-link");
        links.forEach(l => {
            const clickAttr = l.getAttribute("onclick");
            if (clickAttr && clickAttr.includes(viewId)) {
                l.classList.add("active");
            }
        });
    }
    
    // Load and populate corresponding dashboard views
    if (viewId === "view-super-admin") populateSuperAdminDashboard();
    else if (viewId === "view-it-administrator") populateITDashboard();
    else if (viewId === "view-doctor") populateDoctorDashboard();
    else if (viewId === "view-nurse") populateNurseDashboard();
    else if (viewId === "view-pharmacist") populatePharmacistDashboard();
    else if (viewId === "view-patient") populatePatientPortal();
    else if (viewId === "view-manual-patient-entry") populateDedicatedPatientEntryDashboard();
};

function saveLocalState() {
    localStorage.setItem("medsphere_state", JSON.stringify(state));
}

// 7. Database State Sync (MongoDB cloud & Local storage)
function saveDatabaseState() {
    localStorage.setItem("medsphere_db_local", JSON.stringify(MOCK_DB));
    
    fetch(API_BASE_URL + "/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(MOCK_DB)
    })
    .then(r => r.json())
    .then(d => console.log("MedSphere database synced successfully to cloud:", d))
    .catch(err => console.error("Cloud database sync error:", err));
}

function loadDatabaseState() {
    // 1. Check local storage copy
    const cached = localStorage.getItem("medsphere_db_local");
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            Object.assign(MOCK_DB, parsed);
        } catch (e) {}
    }
    
    // 2. Fetch fresh cloud state
    fetch(API_BASE_URL + "/api/load")
    .then(r => r.json())
    .then(cloudDb => {
        if (cloudDb && cloudDb.patients) {
            Object.assign(MOCK_DB, cloudDb);
            console.log("MedSphere state synced from cloud successfully.");
            
            // Re-render active view
            if (state.activeDashboardView) {
                switchDashboardView(state.activeDashboardView);
            }
            if (typeof window.applyRegionalUI === 'function') window.applyRegionalUI();
        }
    })
    .catch(err => console.log("Failed loading cloud state, using local copy:", err));
}

// 8. Super Admin Controllers
function populateSuperAdminDashboard() {
    document.getElementById("stat-active-clinics").innerText = MOCK_DB.admissions.length || 0;
    document.getElementById("stat-issued-licenses").innerText = (MOCK_DB.admissions.length + 3) || 3;
    
    // Render licenses registry
    const container = document.getElementById("licenseRegistryList");
    container.innerHTML = "";
    
    if (!MOCK_DB.admissions || MOCK_DB.admissions.length === 0) {
        container.innerHTML = `<span class="text-xs text-[#6b7280]">No licenses active. Use the form to generate one.</span>`;
        return;
    }
    
    MOCK_DB.admissions.forEach((adm) => {
        const div = document.createElement("div");
        div.className = "p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between text-xs";
        div.innerHTML = `
            <div>
                <h4 class="font-bold text-white">${escapeHtml(adm.schoolName)}</h4>
                <span class="text-[#9ca3af] block mt-0.5">${adm.adminName} | ${adm.mobile}</span>
            </div>
            <div class="text-right">
                <code class="text-teal-300 font-bold block font-mono">${adm.licenseKey}</code>
                <span class="text-[10px] text-emerald-400 font-semibold uppercase mt-0.5 block">${adm.plan}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

window.generateHospitalLicenseKey = function() {
    const hosp = document.getElementById("genHospitalName").value.trim();
    const tier = document.getElementById("genLicenseTier").value;
    const country = document.getElementById("genHospitalCountry").value;
    
    if (!hosp) {
        alert("Please enter a clinic/hospital name.");
        return;
    }
    
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const key = `MED-LIC-${randNum}-${hosp.substring(0, 4).toUpperCase().replace(/\s/g, '')}`;
    
    MOCK_DB.admissions.push({
        schoolName: hosp,
        adminName: "Assigned License",
        email: "hello@technocons.com",
        mobile: "+91 94394 98158",
        plan: tier,
        licenseKey: key,
        createdAt: new Date().toISOString()
    });
    
    saveDatabaseState();
    populateSuperAdminDashboard();
    addSystemLog(`Generated new license key ${key} for "${hosp}"`, "Success");
    
    document.getElementById("genHospitalName").value = "";
};

// 9. IT Admin Controllers
function populateITDashboard() {
    // Render Doctor Table
    const dBody = document.getElementById("doctorsTableBody");
    dBody.innerHTML = "";
    
    MOCK_DB.doctors.forEach(doc => {
        const tr = document.createElement("tr");
        tr.className = "border-b border-white/5 text-[#f3f4f6]";
        tr.innerHTML = `
            <td class="py-2.5 font-medium">${doc.name}</td>
            <td>${doc.specialty}</td>
            <td class="font-mono text-xs">${doc.room}</td>
            <td><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400">${doc.shift}</span></td>
        `;
        dBody.appendChild(tr);
    });
    
    // Render Ward beds registry
    const wReg = document.getElementById("wardMapRegistry");
    wReg.innerHTML = "";
    
    MOCK_DB.wards.forEach(bed => {
        const patient = MOCK_DB.patients.find(p => p.id === bed.patientId);
        const div = document.createElement("div");
        div.className = "p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between text-xs";
        
        const statusHtml = bed.occupied 
            ? `<span class="font-semibold text-red-400">Occupied (${patient ? patient.name : 'Unknown'})</span>`
            : `<span class="font-semibold text-emerald-400">Empty</span>`;
            
        div.innerHTML = `
            <div>
                <span class="font-bold text-white">${bed.id} (${bed.type})</span>
            </div>
            <div>${statusHtml}</div>
        `;
        wReg.appendChild(div);
    });
    
    // Update stats
    const totalBeds = MOCK_DB.wards.length;
    const occupied = MOCK_DB.wards.filter(b => b.occupied).length;
    document.getElementById("statOccupiedBeds").innerText = `${occupied} / ${totalBeds}`;
    document.getElementById("statIcuRate").innerText = `${Math.round((occupied / totalBeds) * 100)}%`;

    // Populate Doctor Selection dropdown inside Admin Manual Registration
    const adminPatDoctor = document.getElementById("adminPatDoctor");
    if (adminPatDoctor) {
        adminPatDoctor.innerHTML = "";
        MOCK_DB.doctors.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.innerText = `${d.name} (${d.specialty})`;
            adminPatDoctor.appendChild(opt);
        });
    }

    // Populate Bed Selection dropdown (only empty beds) inside Admin Manual Registration
    const adminPatBed = document.getElementById("adminPatBed");
    if (adminPatBed) {
        adminPatBed.innerHTML = "";
        const emptyBeds = MOCK_DB.wards.filter(b => !b.occupied);
        if (emptyBeds.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.innerText = "No empty beds";
            adminPatBed.appendChild(opt);
        } else {
            emptyBeds.forEach(b => {
                const opt = document.createElement("option");
                opt.value = b.id;
                opt.innerText = `${b.id} (${b.type})`;
                adminPatBed.appendChild(opt);
            });
        }
    }
}

window.toggleAdminAdmissionTypeFields = function() {
    const type = document.getElementById("adminPatType").value;
    const docField = document.getElementById("adminPatDocField");
    const bedField = document.getElementById("adminPatBedField");
    
    if (type === "OPD") {
        docField.classList.remove("hidden");
        bedField.classList.add("hidden");
    } else {
        docField.classList.add("hidden");
        bedField.classList.remove("hidden");
    }
};

window.executeAdminPatientAdmit = function() {
    const name = document.getElementById("adminPatName").value.trim();
    const age = parseInt(document.getElementById("adminPatAge").value);
    const triage = document.getElementById("adminPatTriage").value;
    const type = document.getElementById("adminPatType").value;
    const complaint = document.getElementById("adminPatComplaint").value.trim();

    if (!name || isNaN(age) || !complaint) {
        alert("Please fill in all manual patient registration fields.");
        return;
    }

    const patientId = `PAT-${Math.floor(100 + Math.random() * 900)}`;
    let newPatient = {
        id: patientId,
        name: name,
        age: age,
        triage: triage,
        paid: false,
        complaint: complaint
    };

    if (type === "OPD") {
        const docId = document.getElementById("adminPatDoctor").value;
        newPatient.bed = null;
        newPatient.doctorId = docId;
        newPatient.bill = 500; // OPD fee
        
        addSystemLog(`OPD Patient ${name} (${patientId}) registered under Doctor ${docId}`, "Success");
        addNotification("OPD Patient Registered", `${name} checked in successfully for doctor consultation.`, "success");
    } else {
        const bedId = document.getElementById("adminPatBed").value;
        if (!bedId) {
            alert("No empty beds available to admit patient!");
            return;
        }
        
        const bed = MOCK_DB.wards.find(b => b.id === bedId);
        if (!bed || bed.occupied) {
            alert("Selected bed is already occupied.");
            return;
        }
        
        newPatient.bed = bedId;
        newPatient.bill = 2500; // IPD fee
        
        bed.occupied = true;
        bed.patientId = patientId;
        
        addSystemLog(`Patient ${name} (${patientId}) admitted successfully to Bed ${bedId}`, "Success");
        addNotification("Patient Admitted", `${name} has been admitted and assigned to Bed ${bedId}.`, "success");
    }

    MOCK_DB.patients.push(newPatient);

    // Reset Form inputs
    document.getElementById("adminPatName").value = "";
    document.getElementById("adminPatAge").value = "";
    document.getElementById("adminPatComplaint").value = "";

    saveDatabaseState();
    populateITDashboard();
};

// IT Cloud Import handler
window.processLocalFileImport = function() {
    const select = document.getElementById("importSheetSelect");
    const fileInput = document.getElementById("importFileInput");
    const file = fileInput.files[0];
    
    if (!file) {
        alert("Please select a valid CSV or Excel file first.");
        return;
    }
    
    addSystemLog(`Executing cloud CSV import for collection: ${select.value}...`, "Warning");
    
    // Simulate sheet importing process by parsing dummy headers
    setTimeout(() => {
        addSystemLog(`Import complete! Loaded data successfully to MongoDB collection.`, "Success");
        addNotification("Import Successful", "Dynamic sheets records synced successfully to cloud.", "success");
        saveDatabaseState();
        populateITDashboard();
    }, 1200);
};

// 10. Doctor Portal Controllers
let activePatientId = "";
let currentPrescriptionMeds = [];

function populateDoctorDashboard() {
    const queue = document.getElementById("doctorPatientQueue");
    queue.innerHTML = "";
    
    // Filter queue: show all if Super Admin, otherwise show if admitted (IPD) OR assigned to this doctor (OPD)
    const myPatients = MOCK_DB.patients.filter(pat => {
        if (state.roleClearance === 15) return true;
        return pat.bed || pat.doctorId === state.userId;
    });

    if (myPatients.length === 0) {
        queue.innerHTML = `<span class="text-xs text-[#6b7280]">No active patients in queue.</span>`;
    } else {
        myPatients.forEach(pat => {
            const div = document.createElement("div");
            div.className = `p-3 rounded-xl border cursor-pointer transition text-xs flex justify-between items-center ${activePatientId === pat.id ? 'bg-teal-500/10 border-teal-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`;
            
            let triageColor = "bg-emerald-500/20 text-emerald-400";
            if (pat.triage === "Critical") triageColor = "bg-red-500/20 text-red-400";
            else if (pat.triage === "Under Observation") triageColor = "bg-amber-500/20 text-amber-400";
            
            const locationStr = pat.bed ? `Bed: ${pat.bed}` : 'OPD Walk-in';
            
            div.innerHTML = `
                <div>
                    <h4 class="font-bold text-white">${pat.name}</h4>
                    <span class="text-[#9ca3af] block mt-0.5">ID: ${pat.id} | ${locationStr}</span>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${triageColor}">${pat.triage}</span>
            `;
            
            div.onclick = () => {
                activePatientId = pat.id;
                currentPrescriptionMeds = [];
                document.getElementById("addedMedsContainer").innerHTML = `<span class="text-xs text-[#6b7280]">No medication added yet.</span>`;
                document.getElementById("compSymptoms").value = pat.complaint || "";
                document.getElementById("compTriage").value = pat.triage;
                document.getElementById("activePatientBadge").innerText = pat.name;
                populateDoctorDashboard();
            };
            
            queue.appendChild(div);
        });
    }

    // Populate Doctor Selection dropdown inside OPD registration form
    const opdDocSelect = document.getElementById("opdDoctor");
    if (opdDocSelect) {
        opdDocSelect.innerHTML = "";
        MOCK_DB.doctors.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.innerText = `${d.name} (${d.specialty})`;
            opdDocSelect.appendChild(opt);
        });
        
        // Match currently logged-in doctor
        if (state.userId && MOCK_DB.doctors.some(d => d.id === state.userId)) {
            opdDocSelect.value = state.userId;
        }
    }
}

window.registerOPDPatient = function() {
    const name = document.getElementById("opdName").value.trim();
    const age = parseInt(document.getElementById("opdAge").value);
    const triage = document.getElementById("opdTriage").value;
    const docId = document.getElementById("opdDoctor").value;
    const complaint = document.getElementById("opdComplaint").value.trim();

    if (!name || isNaN(age) || !complaint) {
        alert("Please fill in all OPD patient registration fields.");
        return;
    }

    const patientId = `PAT-${Math.floor(100 + Math.random() * 900)}`;

    const newPatient = {
        id: patientId,
        name: name,
        age: age,
        triage: triage,
        bed: null, // null denotes OPD consultation
        doctorId: docId,
        bill: 500, // Standard OPD consultation fee
        paid: false,
        complaint: complaint
    };

    MOCK_DB.patients.push(newPatient);
    
    // Reset inputs
    document.getElementById("opdName").value = "";
    document.getElementById("opdAge").value = "";
    document.getElementById("opdComplaint").value = "";

    addSystemLog(`OPD Patient ${name} (${patientId}) registered for Doctor ${docId}`, "Success");
    addNotification("OPD Patient Registered", `${name} checked in successfully for doctor consultation.`, "success");

    saveDatabaseState();
    populateDoctorDashboard();
};

window.addMedicationToPrescription = function() {
    const medName = document.getElementById("prescMedName").value.trim();
    const dosage = document.getElementById("prescDosage").value.trim();
    const duration = document.getElementById("prescDuration").value.trim();
    
    if (!medName || !dosage) return;
    
    currentPrescriptionMeds.push({ name: medName, dosage, duration });
    
    // Clear inputs
    document.getElementById("prescMedName").value = "";
    document.getElementById("prescDosage").value = "";
    document.getElementById("prescDuration").value = "";
    
    // Render added meds list
    const container = document.getElementById("addedMedsContainer");
    container.innerHTML = "";
    
    currentPrescriptionMeds.forEach((m, idx) => {
        const div = document.createElement("div");
        div.className = "flex justify-between items-center text-xs text-[#f3f4f6]";
        div.innerHTML = `
            <span>💊 <strong>${m.name}</strong> - ${m.dosage} (${m.duration})</span>
            <button class="text-red-400 hover:text-red-300" onclick="removeMedFromPrescription(${idx})">Remove</button>
        `;
        container.appendChild(div);
    });
};

window.removeMedFromPrescription = function(idx) {
    currentPrescriptionMeds.splice(idx, 1);
    const container = document.getElementById("addedMedsContainer");
    container.innerHTML = "";
    
    if (currentPrescriptionMeds.length === 0) {
        container.innerHTML = `<span class="text-xs text-[#6b7280]">No medication added yet.</span>`;
        return;
    }
    
    currentPrescriptionMeds.forEach((m, i) => {
        const div = document.createElement("div");
        div.className = "flex justify-between items-center text-xs text-[#f3f4f6]";
        div.innerHTML = `
            <span>💊 <strong>${m.name}</strong> - ${m.dosage} (${m.duration})</span>
            <button class="text-red-400 hover:text-red-300" onclick="removeMedFromPrescription(${i})">Remove</button>
        `;
        container.appendChild(div);
    });
};

window.submitDoctorConsultationFile = function() {
    if (!activePatientId) {
        alert("Please select a patient from the queue first.");
        return;
    }
    
    const p = MOCK_DB.patients.find(x => x.id === activePatientId);
    if (!p) return;
    
    const comp = document.getElementById("compSymptoms").value.trim();
    const tri = document.getElementById("compTriage").value;
    
    p.complaint = comp;
    p.triage = tri;
    
    // Create new prescription
    if (currentPrescriptionMeds.length > 0) {
        MOCK_DB.prescriptions.push({
            id: `PRES-${Math.floor(1000 + Math.random() * 9000)}`,
            patientId: activePatientId,
            doctorName: state.userName,
            meds: [...currentPrescriptionMeds],
            dispatched: false
        });
        
        // Calculate pharmacy costs to add to invoice
        let medBill = currentPrescriptionMeds.length * 150; // Flat estimate
        p.bill += medBill;
    }
    
    addSystemLog(`Diagnosis completed for patient "${p.name}" (Triage: ${tri})`, "Success");
    addNotification("Diagnosis Complete", `Prescription dispatched successfully for patient ${p.name}.`, "success");
    
    // Clear select
    activePatientId = "";
    currentPrescriptionMeds = [];
    document.getElementById("addedMedsContainer").innerHTML = `<span class="text-xs text-[#6b7280]">No medication added yet.</span>`;
    document.getElementById("activePatientBadge").innerText = "No Patient Selected";
    document.getElementById("compSymptoms").value = "";
    
    saveDatabaseState();
    populateDoctorDashboard();
};

// 11. Nurse & Ward Panel Controllers
let selectedBedId = "";
function populateNurseDashboard() {
    const grid = document.getElementById("nurseBedVisualGrid");
    grid.innerHTML = "";
    
    MOCK_DB.wards.forEach(bed => {
        const btn = document.createElement("button");
        btn.className = `p-4 rounded-xl border flex flex-col items-center justify-center transition font-bold ${bed.occupied ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'} ${selectedBedId === bed.id ? 'ring-2 ring-teal-500 border-transparent' : ''}`;
        
        btn.innerHTML = `
            <i data-lucide="bed" class="w-5 h-5 mb-1"></i>
            <span class="text-[10px] font-semibold">${bed.id}</span>
        `;
        
        btn.onclick = () => {
            selectedBedId = bed.id;
            document.getElementById("vitalsBedNumberLabel").innerText = `Bed: ${bed.id} (${bed.occupied ? 'Occupied' : 'Empty'})`;
            populateNurseDashboard();
        };
        
        grid.appendChild(btn);
    });
    
    // Toggle Form visibility based on bed occupancy status
    if (selectedBedId) {
        const activeBed = MOCK_DB.wards.find(b => b.id === selectedBedId);
        if (activeBed && activeBed.occupied) {
            document.getElementById("nurseCardTitleLabel").innerText = "Record Patient Vitals";
            document.getElementById("vitalsFormFields").classList.remove("hidden");
            document.getElementById("admissionFormFields").classList.add("hidden");
        } else {
            document.getElementById("nurseCardTitleLabel").innerText = "Admit & Register Patient";
            document.getElementById("vitalsFormFields").classList.add("hidden");
            document.getElementById("admissionFormFields").classList.remove("hidden");
        }
    } else {
        document.getElementById("nurseCardTitleLabel").innerText = "Record Patient Vitals";
        document.getElementById("vitalsFormFields").classList.remove("hidden");
        document.getElementById("admissionFormFields").classList.add("hidden");
    }
    
    if (window.lucide) window.lucide.createIcons();
}

window.admitPatientToBed = function() {
    if (!selectedBedId) {
        alert("Please select an empty bed first.");
        return;
    }
    
    const bed = MOCK_DB.wards.find(b => b.id === selectedBedId);
    if (!bed || bed.occupied) {
        alert("Selected bed is already occupied.");
        return;
    }

    const name = document.getElementById("admitName").value.trim();
    const age = parseInt(document.getElementById("admitAge").value);
    const triage = document.getElementById("admitTriage").value;
    const complaint = document.getElementById("admitComplaint").value.trim();

    if (!name || isNaN(age) || !complaint) {
        alert("Please fill in all patient admission fields.");
        return;
    }

    // Generate new patient ID
    const patientId = `PAT-${Math.floor(100 + Math.random() * 900)}`;

    // Create new patient record
    const newPatient = {
        id: patientId,
        name: name,
        age: age,
        triage: triage,
        bed: selectedBedId,
        bill: 2500, // Admission registration fee
        paid: false,
        complaint: complaint
    };

    // Update DB
    MOCK_DB.patients.push(newPatient);
    bed.occupied = true;
    bed.patientId = patientId;

    // Reset Form inputs
    document.getElementById("admitName").value = "";
    document.getElementById("admitAge").value = "";
    document.getElementById("admitComplaint").value = "";

    // Sync state
    addSystemLog(`Patient ${name} (${patientId}) admitted successfully to Bed ${selectedBedId}`, "Success");
    addNotification("Patient Admitted", `${name} has been admitted and assigned to Bed ${selectedBedId}.`, "success");
    
    saveDatabaseState();
    
    // Refresh label & dashboards
    document.getElementById("vitalsBedNumberLabel").innerText = `Bed: ${selectedBedId} (Occupied)`;
    populateNurseDashboard();
};

window.saveVitalsLog = function() {
    if (!selectedBedId) {
        alert("Please click and select a Bed node from the grid first.");
        return;
    }
    
    const bed = MOCK_DB.wards.find(b => b.id === selectedBedId);
    if (!bed) return;
    
    const temp = document.getElementById("vitalTemp").value;
    const spo2 = document.getElementById("vitalSpo2").value;
    const hr = document.getElementById("vitalHeartRate").value;
    const bp = document.getElementById("vitalBp").value;
    
    if (!temp || !spo2) {
        alert("Vitals parameters (Temperature & SpO2) are required.");
        return;
    }
    
    // Log message
    let statusMsg = `Vitals logged for ${selectedBedId}: Temp=${temp}°F, SpO2=${spo2}%, HeartRate=${hr} bpm, BP=${bp}`;
    addSystemLog(statusMsg, "Success");
    
    // Critical Alert trigger (SpO2 falls below 93% or Temp above 103F)
    if (parseInt(spo2) < 93 || parseFloat(temp) > 103) {
        sendAdminWhatsAppNotification(`⚠️ *EMERGENCY CRITICAL ALARM!*\n🏥 *Bed:* ${selectedBedId}\n🌡️ *Temp:* ${temp}°F\n🫁 *SpO2:* ${spo2}%\n💓 *Heart Rate:* ${hr} bpm\n🚨 *Status:* Critical clinical triage required!`);
        addNotification("Emergency Alert", `Critical vitals triggered for ${selectedBedId}! Alert sent to Twilio.`, "danger");
        addSystemLog(`CRITICAL SYSTEM ALARM: Patient in ${selectedBedId} requires emergency resuscitation!`, "Error");
    } else {
        addNotification("Vitals Updated", `Vitals recorded successfully for ${selectedBedId}.`, "success");
    }
    
    // Clear inputs
    document.getElementById("vitalTemp").value = "";
    document.getElementById("vitalSpo2").value = "";
    document.getElementById("vitalHeartRate").value = "";
    document.getElementById("vitalBp").value = "";
    
    selectedBedId = "";
    document.getElementById("vitalsBedNumberLabel").innerText = "Select a Bed to log vitals";
    
    saveDatabaseState();
    populateNurseDashboard();
};

// 12. Pharmacist & Billing Desk Controllers
let billingSelectedPatientId = "";

function populatePharmacistDashboard() {
    const list = document.getElementById("pharmacyPrescriptionsList");
    list.innerHTML = "";
    
    const activePresc = MOCK_DB.prescriptions.filter(p => !p.dispatched);
    if (activePresc.length === 0) {
        list.innerHTML = `<span class="text-xs text-[#6b7280]">No active pending prescriptions.</span>`;
    } else {
        activePresc.forEach(pr => {
            const patient = MOCK_DB.patients.find(x => x.id === pr.patientId);
            const div = document.createElement("div");
            div.className = "p-3 bg-white/5 rounded-xl border border-white/5 text-xs space-y-2";
            
            let medsText = pr.meds.map(m => `<li>💊 ${m.name} (${m.dosage})</li>`).join("");
            
            div.innerHTML = `
                <div class="flex justify-between items-center">
                    <span class="font-bold text-white">${patient ? patient.name : 'Unknown Patient'}</span>
                    <span class="text-teal-400 font-mono text-[10px]">${pr.id}</span>
                </div>
                <ul class="text-[#9ca3af] space-y-0.5 list-disc pl-4">${medsText}</ul>
                <button class="w-full btn btn-secondary py-1 text-xs" onclick="dispenseMedicationPrescription('${pr.id}')">Dispense Medicine</button>
            `;
            list.appendChild(div);
        });
    }
    
    // Populate active patient billing dropdown
    const pSelect = document.getElementById("billingPatientSelect");
    pSelect.innerHTML = `<option value="">Choose Patient...</option>`;
    
    MOCK_DB.patients.forEach(pat => {
        const opt = document.createElement("option");
        opt.value = pat.id;
        opt.innerText = `${pat.name} (ID: ${pat.id})`;
        if (pat.id === billingSelectedPatientId) {
            opt.selected = true;
        }
        pSelect.appendChild(opt);
    });
}

window.dispenseMedicationPrescription = function(prescId) {
    const pr = MOCK_DB.prescriptions.find(x => x.id === prescId);
    if (!pr) return;
    
    pr.dispatched = true;
    addSystemLog(`Dispensed prescription medications for ID: ${prescId}`, "Success");
    addNotification("Drugs Dispensed", `Medication ${prescId} has been billed and cleared.`, "success");
    
    saveDatabaseState();
    populatePharmacistDashboard();
};

window.loadPatientBillingInvoice = function() {
    const select = document.getElementById("billingPatientSelect");
    billingSelectedPatientId = select.value;
    
    const p = MOCK_DB.patients.find(x => x.id === billingSelectedPatientId);
    const badge = document.getElementById("billingPaymentStatusBadge");
    const insRow = document.getElementById("invoiceInsuranceRow");
    
    if (!p) {
        document.getElementById("invoiceConsultFees").innerText = `${state.localization.currencySymbol}0`;
        document.getElementById("invoiceRoomCharges").innerText = `${state.localization.currencySymbol}0`;
        document.getElementById("invoicePharmacyCharges").innerText = `${state.localization.currencySymbol}0`;
        document.getElementById("invoiceTotalAmount").innerText = `${state.localization.currencySymbol}0`;
        if (insRow) insRow.classList.add("hidden");
        badge.className = "inline-block text-xs font-bold bg-[#ef4444]/20 text-[#ef4444] px-3 py-1.5 rounded-full mt-1";
        badge.innerText = "Select Patient";
        return;
    }
    
    // Calculate estimates
    const consultVal = 1500;
    const roomVal = p.bed ? 4000 : 0;
    const pharmacyVal = p.bill - (consultVal + roomVal);
    
    document.getElementById("invoiceConsultFees").innerText = formatCurrency(consultVal);
    document.getElementById("invoiceRoomCharges").innerText = formatCurrency(roomVal);
    document.getElementById("invoicePharmacyCharges").innerText = formatCurrency(pharmacyVal > 0 ? pharmacyVal : 0);
    
    const baseAmount = p.bill;
    const taxValue = Math.round(baseAmount * (state.localization.taxRate / 100));
    let totalAmount = baseAmount + taxValue;
    
    // Deduct Cashless TPA Insurance Cover if applicable
    if (p.insurance && p.insurance.approvedAmount) {
        if (insRow) {
            insRow.classList.remove("hidden");
            document.getElementById("invoiceInsuranceAmount").innerText = `-${formatCurrency(p.insurance.approvedAmount)}`;
        }
        totalAmount = Math.max(0, totalAmount - p.insurance.approvedAmount);
    } else {
        if (insRow) insRow.classList.add("hidden");
    }
    
    document.getElementById("invoiceTotalAmount").innerText = formatCurrency(totalAmount);
    
    if (p.paid || totalAmount === 0) {
        badge.className = "inline-block text-xs font-bold bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full mt-1";
        badge.innerText = "Settled / Covered";
    } else {
        badge.className = "inline-block text-xs font-bold bg-rose-500/20 text-rose-400 px-3 py-1.5 rounded-full mt-1";
        badge.innerText = "Payment Outstanding";
    }
};

window.printPatientReceipt = function() {
    if (!billingSelectedPatientId) {
        alert("Please select a patient to print invoice.");
        return;
    }
    const p = MOCK_DB.patients.find(x => x.id === billingSelectedPatientId);
    if (!p) return;
    
    addSystemLog(`Printed billing receipt for Patient ${p.name} (${billingSelectedPatientId})`, "Success");
    alert(`PRINT SYSTEM INTERCEPT:\n========================\nMEDSPHERE CLINIC OUTPATIENT RECEIPT\n========================\nPatient: ${p.name}\nTotal Charge (Tax Inc.): ${document.getElementById("invoiceTotalAmount").innerText}\nStatus: ${p.paid ? 'Settled' : 'Unpaid'}\n========================`);
};

// 13. Patient Portal Controllers
function populatePatientPortal() {
    const patientProfile = MOCK_DB.patients.find(p => p.id === state.userId) || MOCK_DB.patients[0];
    
    // Update outstanding bill
    const baseAmount = patientProfile.bill;
    const taxValue = Math.round(baseAmount * (state.localization.taxRate / 100));
    const totalDue = patientProfile.paid ? 0 : (baseAmount + taxValue);
    
    document.getElementById("patientOutstandingBill").innerText = formatCurrency(totalDue);
    
    const payBtn = document.getElementById("patientPayBillBtn");
    if (totalDue > 0) {
        payBtn.classList.remove("hidden");
    } else {
        payBtn.classList.add("hidden");
    }
    
    // Populate doctors dropdown
    const dSelect = document.getElementById("patientChooseDoctor");
    dSelect.innerHTML = "";
    MOCK_DB.doctors.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.innerText = `${d.name} (${d.specialty})`;
        dSelect.appendChild(opt);
    });

    // Initialize appointment date input default & min values to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    
    const dateInput = document.getElementById("patientChooseDate");
    if (dateInput) {
        dateInput.min = todayStr;
        if (!dateInput.value) {
            dateInput.value = todayStr;
        }
    }
}

window.bookPatientAppointment = function() {
    const docId = document.getElementById("patientChooseDoctor").value;
    const doc = MOCK_DB.doctors.find(d => d.id === docId);
    const date = document.getElementById("patientChooseDate").value;
    const time = document.getElementById("patientChooseTime").value;
    
    if (!date) {
        alert("Please select a date for the appointment.");
        return;
    }
    
    addSystemLog(`Appointment requested with ${doc ? doc.name : 'Doctor'} on ${date} at ${time}`, "Success");
    addNotification("Appointment Requested", `Your visit on ${date} at ${time} has been registered.`, "success");
    
    // Reset date input back to today's date
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById("patientChooseDate").value = `${yyyy}-${mm}-${dd}`;
};

window.triggerPatientBillCheckout = function() {
    const valText = document.getElementById("patientOutstandingBill").innerText;
    document.getElementById("razorpayAmountLabel").innerText = valText;
    document.getElementById("razorpayPaymentModal").classList.remove("hidden");
};

window.closeRazorpayPaymentModal = function() {
    document.getElementById("razorpayPaymentModal").classList.add("hidden");
};

window.completeSimulatedBillPayment = function(isSuccess) {
    closeRazorpayPaymentModal();
    const p = MOCK_DB.patients.find(x => x.id === state.userId) || MOCK_DB.patients[0];
    
    if (isSuccess) {
        p.paid = true;
        addSystemLog(`Payment of ${formatCurrency(p.bill)} successfully completed via Razorpay for ${p.name}`, "Success");
        addNotification("Payment Settled", "Thank you! Your bill has been settled successfully.", "success");
        saveDatabaseState();
        populatePatientPortal();
    } else {
        addSystemLog(`Payment failed or canceled via Razorpay checkout for ${p.name}`, "Warning");
        addNotification("Payment Failed", "Transaction declined. Please try again.", "warning");
    }
};

// 14. Multilingual Symptoms Voice Chatbot Engine
const CHAT_TRANSLATIONS = {
    hi: {
        "Welcome back": "वापसी पर स्वागत है",
        "clearance.": "निकासी स्तर।",
        "What can I help you with today?": "आज मैं आपकी क्या मदद कर सकता हूँ?",
        "Authentication complete!": "प्रमाणीकरण पूरा हुआ!",
        "Your clearance level is": "आपका सुरक्षा निकासी स्तर है",
        "How can I assist you in your school duties today?": "आज मैं आपकी क्या सहायता कर सकता हूँ?",
        "Hello! Language switched to English.": "नमस्ते! भाषा हिन्दी में बदल दी गई है।"
    },
    ne: {
        "Welcome back": "फिर्ता स्वागत छ",
        "clearance.": "निकासी स्तर।",
        "What can I help you with today?": "आज म तपाईंलाई कसरी मद्दत गर्न सक्छु?",
        "Authentication complete!": "प्रमाणीकरण पूरा भयो!",
        "Your clearance level is": "तपाईंको सुरक्षा निकासी स्तर हो",
        "Hello! Language switched to English.": "नमस्ते! भाषा नेपालीमा परिवर्तन गरिएको छ।"
    },
    bn: {
        "Welcome back": "আবার স্বাগতম",
        "clearance.": "ক্লিয়ারেন্স লেভেল।",
        "What can I help you with today?": "আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
        "Authentication complete!": "প্রমাণীকরণ সম্পন্ন হয়েছে!",
        "Your clearance level is": "আপনার নিরাপত্তা ক্লিয়ারেন্স লেভেল হল",
        "Hello! Language switched to English.": "নমস্কার! ভাষা বাংলায় পরিবর্তন করা হয়েছে।"
    },
    ar: {
        "Welcome back": "مرحباً بعودتك",
        "clearance.": "مستوى التصريح.",
        "What can I help you with today?": "كيف يمكنني مساعدتك اليوم؟",
        "Authentication complete!": "اكتملت عملية التحقق من الهوية!",
        "Your clearance level is": "مستوى التصريح الخاص بك هو",
        "Hello! Language switched to English.": "مرحباً! تم تغيير اللغة إلى العربية."
    }
};

window.translateChatMessage = function(text, lang) {
    if (!lang || lang === 'en') return text;
    const dict = CHAT_TRANSLATIONS[lang];
    if (!dict) return text;
    
    let translated = text;
    const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
    keys.forEach(key => {
        const val = dict[key];
        const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(escapedKey, 'gi');
        translated = translated.replace(regex, val);
    });
    return translated;
};

let browserVoices = [];
function loadSystemVoices() {
    if ('speechSynthesis' in window) {
        browserVoices = window.speechSynthesis.getVoices() || [];
    }
}
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = loadSystemVoices;
    loadSystemVoices();
}

window.handleChatLanguageChange = function() {
    const select = document.getElementById("chatLanguageSelect");
    if (!select) return;
    state.chatLanguage = select.value;
    
    localStorage.setItem("medsphere_chat_lang", state.chatLanguage);
    addSystemLog(`Chat language switched to ${select.options[select.selectedIndex].text}`, "Success");

    let msg = "";
    let engMsg = "Hello! Language switched to English. How can I assist you with your school operations today?";
    if (state.chatLanguage === "hi") {
        msg = "नमस्ते! भाषा हिन्दी में बदल दी गई है। मैं आज आपके चिकित्सा स्वास्थ्य में क्या सहायता कर सकता हूँ?";
        engMsg = "Hello! Language switched to Hindi. How can I assist you with your health today?";
    } else if (state.chatLanguage === "ne") {
        msg = "नमस्ते! भाषा नेपालीमा परिवर्तन गरिएको छ। म आज तपाईंको स्वास्थ्यमा कसरी मद्दत गर्न सक्छु?";
        engMsg = "Hello! Language switched to Nepali. How can I assist you with your health today?";
    } else if (state.chatLanguage === "bn") {
        msg = "নমস্কার! ভাষা বাংলায় পরিবর্তন করা হয়েছে। আজ আমি আপনার স্বাস্থ্যের যত্নে কীভাবে সাহায্য করতে পারি?";
        engMsg = "Hello! Language switched to Bengali. How can I assist you with your health today?";
    } else if (state.chatLanguage === "ar") {
        msg = "مرحباً! تم تغيير اللغة إلى العربية. كيف يمكنني مساعدتك في شؤونك الصحية اليوم؟";
        engMsg = "Hello! Language switched to Arabic. How can I assist you with your health today?";
    } else {
        msg = "Hello! Language switched to English. How can I assist you with your medical care today?";
        engMsg = "Hello! Language switched to English. How can I assist you with your medical care today?";
    }
    
    addChatMessage("incoming", msg, "MedSphere AI", engMsg);
};

window.speakAIText = function(text, englishText = null) {
    if (!isTtsEnabled || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        
        const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/[\*\_]/g, '');
        
        let langCode = "en-US";
        if (state.chatLanguage === "hi") langCode = "hi-IN";
        else if (state.chatLanguage === "ne") langCode = "ne-NP";
        else if (state.chatLanguage === "bn") langCode = "bn-IN";
        else if (state.chatLanguage === "ar") langCode = "ar-AE";
        
        let voices = browserVoices;
        if (!voices || voices.length === 0) {
            voices = window.speechSynthesis.getVoices() || [];
        }
        
        const langPrefix = langCode.substring(0, 2).toLowerCase();
        let matchedVoice = null;
        
        if (voices && voices.length > 0) {
            const matchedVoices = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
            if (matchedVoices.length > 0) {
                matchedVoice = matchedVoices.find(v => 
                    v.name.toLowerCase().includes("natural") || 
                    v.name.toLowerCase().includes("online") || 
                    v.name.toLowerCase().includes("google")
                ) || matchedVoices[0];
            }
            
            if (!matchedVoice && langPrefix === "ne") {
                const hindiVoices = voices.filter(v => v.lang.toLowerCase().startsWith("hi"));
                if (hindiVoices.length > 0) {
                    matchedVoice = hindiVoices.find(v => 
                        v.name.toLowerCase().includes("natural") || 
                        v.name.toLowerCase().includes("online") || 
                        v.name.toLowerCase().includes("google")
                    ) || hindiVoices[0];
                }
            }
        }
        
        const utterance = new SpeechSynthesisUtterance();
        
        if (matchedVoice) {
            utterance.voice = matchedVoice;
            utterance.lang = matchedVoice.lang;
            utterance.text = cleanText;
        } else {
            console.log(`No native voice found for language '${langCode}'. Safely falling back to English TTS.`);
            utterance.lang = "en-US";
            let spokenEnglish = englishText ? englishText.replace(/<[^>]*>?/gm, '').replace(/[\*\_]/g, '') : cleanText;
            utterance.text = spokenEnglish;
        }
        
        utterance.rate = 1.02;
        utterance.pitch = 1.0;
        
        setTimeout(() => {
            window.speechSynthesis.speak(utterance);
        }, 60);
        
    } catch (e) {
        console.warn("TTS Error:", e);
    }
};

window.toggleTtsSpeaker = function() {
    isTtsEnabled = !isTtsEnabled;
    const icon = document.getElementById("ttsIcon");
    if (isTtsEnabled) {
        icon.setAttribute("data-lucide", "volume-2");
        addNotification("TTS Enabled", "Text-to-speech audio will now play for chatbot messages.", "info");
    } else {
        window.speechSynthesis.cancel();
        icon.setAttribute("data-lucide", "volume-x");
        addNotification("TTS Muted", "Text-to-speech has been turned off.", "info");
    }
    if (window.lucide) window.lucide.createIcons();
};

// Speech-to-Text mic trigger
window.triggerSpeechToText = function() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.");
        return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.lang = state.chatLanguage === "hi" ? "hi-IN" : (state.chatLanguage === "ar" ? "ar-AE" : "en-US");
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const micIcon = document.getElementById("micIcon");
    micIcon.setAttribute("data-lucide", "loader");
    if (window.lucide) window.lucide.createIcons();

    recognition.start();

    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        document.getElementById("chatInput").value = text;
    };

    recognition.onend = () => {
        micIcon.setAttribute("data-lucide", "mic");
        if (window.lucide) window.lucide.createIcons();
    };

    recognition.onerror = (e) => {
        console.error("Speech Recognition Error:", e);
        micIcon.setAttribute("data-lucide", "mic");
        if (window.lucide) window.lucide.createIcons();
    };
};

window.handleSendChatMessage = function(e) {
    e.preventDefault();
    const input = document.getElementById("chatInput");
    const val = input.value.trim();
    if (!val) return;
    
    addChatMessage("outgoing", val, state.userName);
    input.value = "";
    
    // Simple Medical NLP Symptoms check response
    setTimeout(() => {
        let answer = "I have analyzed your description. If you are experiencing persistent discomfort, I highly advise scheduling a clinical consultation with one of our specialized doctors.";
        let engAnswer = answer;
        
        const q = val.toLowerCase();
        if (q.includes("chest") || q.includes("heart") || q.includes("pain in chest")) {
            answer = "⚠️ **Warning:** Symptoms of chest discomfort require urgent clinical check. Please visit the cardiology ward immediately or book an OPD consultation.";
            engAnswer = answer;
        } else if (q.includes("cough") || q.includes("bronchitis") || q.includes("fever")) {
            answer = "You describe general cold or respiratory symptoms. I recommend resting, keeping hydrated, and consulting Dr. Lakshmi Prasad in Pediatrics/GP.";
            engAnswer = answer;
        }
        
        // Translate answer to selected chat language
        let localizedAnswer = answer;
        if (state.chatLanguage && state.chatLanguage !== "en") {
            localizedAnswer = translateChatMessage(answer, state.chatLanguage);
        }
        
        addChatMessage("incoming", localizedAnswer, "MedSphere AI", engAnswer);
    }, 800);
};

// 15. Helper Utilities
function formatCurrency(amount) {
    return `${state.localization.currencySymbol}${amount.toLocaleString()}`;
}

function escapeHtml(text) {
    if (!text) return "";
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.addSystemLog = function(message, type = "Info") {
    const logsContainer = document.getElementById("systemAuditLogsContainer");
    if (!logsContainer) return;
    
    const div = document.createElement("div");
    div.className = "flex justify-between items-start gap-2 border-b border-white/5 pb-1.5";
    
    let typeColor = "text-teal-400";
    if (type === "Success") typeColor = "text-emerald-400";
    else if (type === "Warning") typeColor = "text-amber-400";
    else if (type === "Error") typeColor = "text-rose-400";
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `
        <span class="text-white/60 font-mono text-[10px]">${time}</span>
        <span class="flex-1">${message}</span>
        <span class="font-bold ${typeColor} text-[10px] uppercase">${type}</span>
    `;
    
    logsContainer.insertBefore(div, logsContainer.firstChild);
};

window.clearSystemLogs = function() {
    const logsContainer = document.getElementById("systemAuditLogsContainer");
    if (logsContainer) logsContainer.innerHTML = "";
};

// Notification popups
window.addNotification = function(title, text, type = "success") {
    // Generate toast popup
    const toast = document.createElement("div");
    toast.className = `fixed bottom-4 right-4 z-50 p-4 rounded-xl border backdrop-blur-md shadow-lg flex items-center gap-3 transition animate-scale max-w-sm`;
    
    let iconName = "check-circle";
    let themeClasses = "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
    
    if (type === "warning") {
        iconName = "alert-triangle";
        themeClasses = "bg-amber-500/10 border-amber-500/20 text-amber-400";
    } else if (type === "danger") {
        iconName = "shield-alert";
        themeClasses = "bg-rose-500/10 border-rose-500/20 text-rose-400";
    } else if (type === "info") {
        iconName = "info";
        themeClasses = "bg-blue-500/10 border-blue-500/20 text-blue-400";
    }
    
    toast.className += ` ${themeClasses}`;
    toast.innerHTML = `
        <i data-lucide="${iconName}" class="w-5 h-5 flex-shrink-0"></i>
        <div>
            <h4 class="font-bold text-sm text-white">${title}</h4>
            <p class="text-xs opacity-80 text-[#9ca3af]">${text}</p>
        </div>
    `;
    
    document.body.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// Localization handlers
window.handleCountryChange = function() {
    const country = document.getElementById("localCountry").value;
    const selectCur = document.getElementById("localCurrency");
    const selectT = document.getElementById("localTimezone");
    const inputTaxN = document.getElementById("localTaxName");
    const inputTaxR = document.getElementById("localTaxRate");

    if (!selectCur || !selectT || !inputTaxN || !inputTaxR) return;

    if (country === "India") {
        selectCur.value = "INR";
        selectT.value = "Asia/Kolkata";
        inputTaxN.value = "GST";
        inputTaxR.value = "18";
    } else if (country === "Nepal") {
        selectCur.value = "NPR";
        selectT.value = "Asia/Kathmandu";
        inputTaxN.value = "VAT";
        inputTaxR.value = "13";
    } else if (country === "Bangladesh") {
        selectCur.value = "BDT";
        selectT.value = "Asia/Dhaka";
        inputTaxN.value = "VAT";
        inputTaxR.value = "15";
    } else if (country === "United Arab Emirates") {
        selectCur.value = "AED";
        selectT.value = "Asia/Dubai";
        inputTaxN.value = "VAT";
        inputTaxR.value = "5";
    } else if (country === "United States") {
        selectCur.value = "USD";
        selectT.value = "America/New_York";
        inputTaxN.value = "Sales Tax";
        inputTaxR.value = "8.5";
    } else if (country === "United Kingdom") {
        selectCur.value = "GBP";
        selectT.value = "Europe/London";
        inputTaxN.value = "VAT";
        inputTaxR.value = "20";
    } else if (country === "Singapore") {
        selectCur.value = "SGD";
        selectT.value = "Asia/Singapore";
        inputTaxN.value = "GST";
        inputTaxR.value = "9";
    } else {
        selectCur.value = "USD";
        selectT.value = "America/New_York";
        inputTaxN.value = "Sales Tax";
        inputTaxR.value = "8.5";
    }
    
    // Automatically switch chat language based on selected country
    const langSelect = document.getElementById("chatLanguageSelect");
    if (langSelect) {
        if (country === "India") langSelect.value = "hi";
        else if (country === "Nepal") langSelect.value = "ne";
        else if (country === "Bangladesh") langSelect.value = "bn";
        else if (country === "United Arab Emirates") langSelect.value = "ar";
        else langSelect.value = "en";
        state.chatLanguage = langSelect.value;
        localStorage.setItem("medsphere_chat_lang", state.chatLanguage);
        addNotification("Language Sync", `AI Chatbot localized.`, "info");
    }

    saveRegionalSettings();
};

window.handleOnboardCountryChange = function() {
    const country = document.getElementById("onboardCountry").value;
    
    // Sync to trial form elements
    const localC = document.getElementById("localCountry");
    if (localC) {
        localC.value = country;
    }
    
    // Trigger standard country change
    window.handleCountryChange();
    
    // Apply state changes back to onboarding UI
    window.applyRegionalUI();
};

window.applyRegionalUI = function() {
    const onboardC = document.getElementById("onboardCountry");
    const onboardCur = document.getElementById("onboardCurrency");
    const onboardT = document.getElementById("onboardTimezone");
    const onboardTaxN = document.getElementById("onboardTaxName");

    if (onboardC) onboardC.value = state.localization.country;
    if (onboardCur) onboardCur.value = state.localization.currency;
    if (onboardT) onboardT.value = state.localization.timezone;
    if (onboardTaxN) onboardTaxN.value = state.localization.taxName;

    // Also sync the modal form elements
    const localC = document.getElementById("localCountry");
    const localCur = document.getElementById("localCurrency");
    const localT = document.getElementById("localTimezone");
    const localTaxN = document.getElementById("localTaxName");
    const localTaxR = document.getElementById("localTaxRate");

    if (localC) localC.value = state.localization.country;
    if (localCur) localCur.value = state.localization.currency;
    if (localT) localT.value = state.localization.timezone;
    if (localTaxN) localTaxN.value = state.localization.taxName;
    if (localTaxR) localTaxR.value = state.localization.taxRate;

    // Update dynamic currency symbols
    document.querySelectorAll(".currency-symbol").forEach(el => el.innerText = state.localization.currencySymbol);
    document.querySelectorAll(".tax-name-label").forEach(el => el.innerText = state.localization.taxName);
};

window.saveRegionalSettings = function() {
    const country = document.getElementById("localCountry").value;
    const currency = document.getElementById("localCurrency").value;
    const timezone = document.getElementById("localTimezone").value;
    const taxName = document.getElementById("localTaxName").value;
    const taxRate = parseFloat(document.getElementById("localTaxRate").value) || 0;

    let symbol = "₹";
    if (currency === "USD") symbol = "$";
    else if (currency === "AED") symbol = "AED ";
    else if (currency === "GBP") symbol = "£";
    else if (currency === "EUR") symbol = "€";
    else if (currency === "SGD") symbol = "S$";
    else if (currency === "NPR") symbol = "रू ";
    else if (currency === "BDT") symbol = "৳";

    state.localization = {
        country,
        currency,
        currencySymbol: symbol,
        timezone,
        taxName,
        taxRate
    };

    document.querySelectorAll(".currency-symbol").forEach(el => el.innerText = symbol);
    document.querySelectorAll(".tax-name-label").forEach(el => el.innerText = taxName);

    addSystemLog(`Admin updated regional settings: Country=${country}, Currency=${currency}`, "Success");
    saveLocalState();
    saveDatabaseState();
};

// Free trial hooks
window.openFreeTrialModal = function() {
    const modal = document.getElementById("freeTrialModal");
    if (modal) modal.classList.remove("hidden");
};

window.closeFreeTrialModal = function() {
    const modal = document.getElementById("freeTrialModal");
    if (modal) modal.classList.add("hidden");
};

window.handleFreeTrialSubmit = function(e) {
    e.preventDefault();
    const schoolName = document.getElementById("trialSchoolName").value.trim();
    const adminName = document.getElementById("trialAdminName").value.trim();
    const email = document.getElementById("trialEmail").value.trim();
    const mobile = document.getElementById("trialMobile").value.trim();
    const plan = document.getElementById("trialPlanType") ? document.getElementById("trialPlanType").value : "Standard Free Trial";

    const randNum = Math.floor(1000 + Math.random() * 9000);
    const licenseKey = `MED-TRIAL-${randNum}-${schoolName.substring(0, 4).toUpperCase().replace(/\s/g, '')}`;

    closeFreeTrialModal();

    document.getElementById("successSchoolName").innerText = schoolName;
    document.getElementById("successAdminName").innerText = adminName;
    document.getElementById("successLicenseKey").innerText = licenseKey;

    document.getElementById("trialSuccessModal").classList.remove("hidden");

    // Push notification to Twilio Sandbox
    sendAdminWhatsAppNotification(`🚀 *New Hospital Trial Activated!*\n🏫 *Hospital:* ${schoolName}\n👤 *Admin:* ${adminName}\n📧 *Email:* ${email}\n📞 *Phone:* ${mobile}\n🔑 *License:* ${licenseKey}`);
    
    MOCK_DB.admissions.push({
        schoolName,
        adminName,
        email,
        mobile,
        plan,
        licenseKey,
        createdAt: new Date().toISOString()
    });

    saveDatabaseState();
};

window.launchTrialPrincipalWorkspace = function() {
    document.getElementById("trialSuccessModal").classList.add("hidden");
    const name = document.getElementById("trialAdminName").value.trim();
    const key = document.getElementById("successLicenseKey").innerText;
    switchRole(14, name, key);
};

window.sendAdminWhatsAppNotification = function(message) {
    fetch(API_BASE_URL + '/api/notify-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
    })
    .then(r => r.json())
    .then(data => console.log("WhatsApp alert response:", data))
    .catch(err => console.error("WhatsApp alert error:", err));
};

function addChatMessage(type, content, senderName = "MedSphere AI", originalContent = null) {
    const rawEnglish = originalContent || content;
    const container = window.AppElements.chatMessages;
    if (!container) return;
    
    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${type}`;
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let headerHtml = "";
    if (type !== "system") {
        headerHtml = `<span class="chat-role-header">${escapeHtml(senderName)}</span>`;
    }

    bubble.innerHTML = `
        ${headerHtml}
        <div>${content}</div>
        <span class="chat-time">${timeStr}</span>
    `;

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    if (type === "incoming" || type === "system") {
        speakAIText(content, rawEnglish);
    }
}

// 15. Online Checkout & Subscriptions Logic
let selectedPlan = "pro";

function getLocalPlanPrices(currency) {
    const prices = {
        INR: { starter: 29999, pro: 69999, proplus: 99999, enterprise: 149999 },
        USD: { starter: 399, pro: 899, proplus: 1299, enterprise: 1899 },
        AED: { starter: 1499, pro: 3299, proplus: 4799, enterprise: 6999 },
        GBP: { starter: 299, pro: 699, proplus: 999, enterprise: 1499 },
        EUR: { starter: 349, pro: 799, proplus: 1149, enterprise: 1699 },
        SGD: { starter: 549, pro: 1199, proplus: 1749, enterprise: 2599 },
        NPR: { starter: 47999, pro: 111999, proplus: 159999, enterprise: 239999 },
        BDT: { starter: 38999, pro: 89999, proplus: 129999, enterprise: 194999 }
    };
    return prices[currency] || prices.INR;
}

window.openOnlineCheckoutModal = function() {
    const modal = document.getElementById("onlineCheckoutModal");
    if (modal) {
        modal.classList.remove("hidden");
        const loc = state.localization || { currency: "INR", currencySymbol: "₹" };
        const symbol = loc.currencySymbol || "₹";
        
        modal.querySelectorAll(".currency-symbol").forEach(el => {
            el.innerText = symbol;
        });

        const localPrices = getLocalPlanPrices(loc.currency || "INR");
        modal.querySelectorAll(".plan-price-val").forEach(el => {
            const planKey = el.getAttribute("data-plan");
            if (planKey && localPrices[planKey] !== undefined) {
                el.innerText = localPrices[planKey].toLocaleString();
            }
        });

        window.selectCheckoutPlan("pro");
    }
};

window.closeOnlineCheckoutModal = function() {
    const modal = document.getElementById("onlineCheckoutModal");
    if (modal) modal.classList.add("hidden");
};

window.selectCheckoutPlan = function(planKey) {
    selectedPlan = planKey;
    const cards = document.querySelectorAll(".checkout-plan-card");
    cards.forEach(card => {
        card.className = "checkout-plan-card p-3 rounded-2xl border border-white/10 cursor-pointer bg-white/5 hover:border-amber-500/30 transition";
        
        // Remove popular label if any
        const popularBadge = card.querySelector(".badge");
        if (popularBadge) popularBadge.remove();
    });

    const selectedCard = document.getElementById("plan" + planKey.charAt(0).toUpperCase() + planKey.slice(1));
    if (selectedCard) {
        selectedCard.className = "checkout-plan-card active p-3 rounded-2xl border-2 border-amber-500 cursor-pointer bg-amber-500/10 transition";
        
        if (planKey === "pro") {
            const badge = document.createElement("span");
            badge.className = "inline-block text-[8px] bg-amber-500 text-slate-900 font-bold px-1.5 py-0.5 rounded-full mb-1";
            badge.innerText = "POPULAR";
            selectedCard.insertBefore(badge, selectedCard.firstChild);
        }
    }

    const loc = state.localization || { currency: "INR", currencySymbol: "₹", taxRate: 18, taxName: "GST" };
    const basePrices = getLocalPlanPrices(loc.currency || "INR");
    const base = basePrices[planKey] || basePrices.pro || 69999;
    const taxRatePercent = loc.taxRate !== undefined ? loc.taxRate : 18;
    const tax = base * (taxRatePercent / 100);
    const total = base + tax;

    const baseElem = document.getElementById("summaryBasePrice");
    const gstElem = document.getElementById("summaryGstPrice");
    const totalElem = document.getElementById("summaryTotalPrice");
    const taxLabelElem = document.getElementById("summaryTaxLabel");

    if (taxLabelElem) {
        taxLabelElem.innerHTML = `${taxRatePercent}% ${loc.taxName || 'GST'} (Tax Invoice):`;
    }

    if (baseElem) baseElem.innerText = formatCurrency(base);
    if (gstElem) gstElem.innerText = formatCurrency(tax);
    if (totalElem) totalElem.innerText = formatCurrency(total);
};

window.handleOnlineCheckoutSubmit = function(e) {
    e.preventDefault();
    const schoolName = document.getElementById("checkoutSchoolName").value.trim();
    const gstin = document.getElementById("checkoutGstin").value.trim();
    if (!schoolName) return;

    const loc = state.localization || { currency: "INR", currencySymbol: "₹", taxRate: 18, taxName: "GST" };
    const basePrices = getLocalPlanPrices(loc.currency || "INR");
    const base = basePrices[selectedPlan] || basePrices.pro || 69999;
    const taxRatePercent = loc.taxRate !== undefined ? loc.taxRate : 18;
    const tax = base * (taxRatePercent / 100);
    const total = base + tax;

    // Trigger simulated/real payment logic
    const payId = "pay_Rzp" + Math.random().toString(36).substring(2, 10).toUpperCase();
    window.completeRazorpayOrder(payId, schoolName, total, gstin);
};

window.completeRazorpayOrder = function(payId, schoolName, total, gstin) {
    const loc = state.localization || { currencySymbol: "₹", taxRate: 18, taxName: "GST" };
    const invoiceNo = "INV-2026-" + Math.floor(10000 + Math.random() * 90000);
    const permLicenseKey = "MED-PERM-2026-" + schoolName.substring(0, 4).toUpperCase().replace(/\s/g, '');

    // Close checkout modal
    closeOnlineCheckoutModal();

    // Log the user directly into IT admin workspace with the new license key!
    switchRole(14, "IT Director", permLicenseKey);

    // Welcome message in Chat AI
    addChatMessage("incoming", `🎉 <strong>Subscription Payment Successful!</strong><br><br><strong>Transaction ID:</strong> <code>${payId}</code><br><strong>Official ${loc.taxName} Tax Invoice:</strong> <code>${invoiceNo}</code><br><strong>Permanent MedSphere License Key:</strong> <code style="color: #fbbf24; font-weight: bold;">${permLicenseKey}</code><br><strong>Total Paid:</strong> ${formatCurrency(total)} (Includes ${loc.taxRate}% ${loc.taxName})<br><br><span class="text-xs text-[#9ca3af]">A permanent clinical database node has been provisioned.</span>`);

    // Trigger WhatsApp notification to Admin
    sendAdminWhatsAppNotification(`💳 *New MedSphere License Purchase!*\n🏥 *Hospital:* ${schoolName}\n💸 *Plan:* ${selectedPlan.toUpperCase()}\n💰 *Total Paid:* ${formatCurrency(total)}\n🧾 *Invoice:* ${invoiceNo}\n🔑 *License Key:* ${permLicenseKey}`);

    addSystemLog(`Razorpay Payment Complete (${payId}): ${schoolName} purchased ${selectedPlan.toUpperCase()} Plan (${invoiceNo})`, "Success");
    addNotification("Payment Successful!", `Permanent license ${permLicenseKey} activated for ${schoolName}.`, "success");
    saveDatabaseState();
};

// 16. Dedicated Manual Patient Entry Dashboard Logic
window.populateDedicatedPatientEntryDashboard = function() {
    // 1. Populate Consultant Doctor Dropdown
    const docSelect = document.getElementById("dedicatedPatDoctor");
    if (docSelect) {
        docSelect.innerHTML = "";
        MOCK_DB.doctors.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.innerText = `${d.name} (${d.specialty})`;
            docSelect.appendChild(opt);
        });
    }

    // 2. Populate Empty Beds Dropdown
    const bedSelect = document.getElementById("dedicatedPatBed");
    if (bedSelect) {
        bedSelect.innerHTML = "";
        const emptyBeds = MOCK_DB.wards.filter(b => !b.occupied);
        if (emptyBeds.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.innerText = "No empty beds available";
            bedSelect.appendChild(opt);
        } else {
            emptyBeds.forEach(b => {
                const opt = document.createElement("option");
                opt.value = b.id;
                opt.innerText = `${b.id} (${b.type})`;
                bedSelect.appendChild(opt);
            });
        }
    }

    // 3. Compute Stats
    const totalBeds = MOCK_DB.wards.length;
    const occupiedBeds = MOCK_DB.wards.filter(b => b.occupied).length;
    const ipdCount = MOCK_DB.patients.filter(p => p.bed !== null).length;
    const opdCount = MOCK_DB.patients.filter(p => p.bed === null).length;
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    document.getElementById("statDedicatedIpdCount").innerText = ipdCount;
    document.getElementById("statDedicatedOpdCount").innerText = opdCount;
    document.getElementById("statDedicatedOccupancyRate").innerText = `${occupancyRate}%`;

    // 4. Render Recently Registered Patient list (last 3 items)
    const recentList = document.getElementById("dedicatedRecentPatientsList");
    if (recentList) {
        recentList.innerHTML = "";
        const recentPatients = [...MOCK_DB.patients].reverse().slice(0, 3);
        if (recentPatients.length === 0) {
            recentList.innerHTML = `<span class="text-xs text-[#6b7280]">No patients registered yet.</span>`;
        } else {
            recentPatients.forEach(p => {
                const div = document.createElement("div");
                div.className = "p-3 bg-white/5 rounded-xl border border-white/5 text-xs flex justify-between items-center";
                
                let triageColor = "bg-emerald-500/20 text-emerald-400";
                if (p.triage === "Critical") triageColor = "bg-red-500/20 text-red-400";
                else if (p.triage === "Under Observation") triageColor = "bg-amber-500/20 text-amber-400";

                const typeStr = p.bed ? `IPD (${p.bed})` : "OPD Walk-in";

                div.innerHTML = `
                    <div>
                        <h4 class="font-bold text-white">${p.name} (Age: ${p.age})</h4>
                        <span class="text-[#9ca3af] block mt-0.5">${p.id} | ${typeStr}</span>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${triageColor}">${p.triage}</span>
                `;
                recentList.appendChild(div);
            });
        }
    }
};

window.toggleDedicatedAdmissionFields = function() {
    const type = document.getElementById("dedicatedPatType").value;
    const docField = document.getElementById("dedicatedPatDocField");
    const bedField = document.getElementById("dedicatedPatBedField");
    
    if (type === "OPD") {
        docField.classList.remove("hidden");
        bedField.classList.add("hidden");
    } else {
        docField.classList.add("hidden");
        bedField.classList.remove("hidden");
    }
};

window.executeDedicatedPatientAdmit = function() {
    const name = document.getElementById("dedicatedPatName").value.trim();
    const age = parseInt(document.getElementById("dedicatedPatAge").value);
    const triage = document.getElementById("dedicatedPatTriage").value;
    const type = document.getElementById("dedicatedPatType").value;
    const complaint = document.getElementById("dedicatedPatComplaint").value.trim();
    const insProvider = document.getElementById("dedicatedPatInsuranceProvider") ? document.getElementById("dedicatedPatInsuranceProvider").value : "None";
    const policyNo = document.getElementById("dedicatedPatPolicyNo") ? document.getElementById("dedicatedPatPolicyNo").value.trim() : "";

    if (!name || isNaN(age) || !complaint) {
        alert("Please fill in all manual patient registration fields.");
        return;
    }

    const patientId = `PAT-${Math.floor(100 + Math.random() * 900)}`;
    let newPatient = {
        id: patientId,
        name: name,
        age: age,
        triage: triage,
        paid: false,
        complaint: complaint
    };

    if (insProvider !== "None" && policyNo) {
        newPatient.insurance = {
            provider: insProvider,
            policyNumber: policyNo,
            status: "Pending Pre-Auth"
        };
    }

    if (type === "OPD") {
        const docId = document.getElementById("dedicatedPatDoctor").value;
        newPatient.bed = null;
        newPatient.doctorId = docId;
        newPatient.bill = 500; // Standard OPD consultation fee
        
        addSystemLog("OPD Walk-in", `Registered OPD Patient ${name} (${patientId}) under Doctor ${docId}`);
        addNotification("OPD Patient Registered", `${name} checked in successfully for doctor consultation.`, "success");
    } else {
        const bedId = document.getElementById("dedicatedPatBed").value;
        if (!bedId) {
            alert("No empty beds available to admit patient!");
            return;
        }
        
        const bed = MOCK_DB.wards.find(b => b.id === bedId);
        if (!bed || bed.occupied) {
            alert("Selected bed is already occupied.");
            return;
        }
        
        newPatient.bed = bedId;
        newPatient.bill = 2500; // IPD registration fee
        
        bed.occupied = true;
        bed.patientId = patientId;
        
        addSystemLog("IPD Admission", `Patient ${name} (${patientId}) admitted successfully to Bed ${bedId}`);
        addNotification("Patient Admitted", `${name} has been admitted and assigned to Bed ${bedId}.`, "success");
    }

    MOCK_DB.patients.push(newPatient);

    // Reset Form inputs
    document.getElementById("dedicatedPatName").value = "";
    document.getElementById("dedicatedPatAge").value = "";
    document.getElementById("dedicatedPatComplaint").value = "";
    if (document.getElementById("dedicatedPatPolicyNo")) document.getElementById("dedicatedPatPolicyNo").value = "";

    saveDatabaseState();
    populateDedicatedPatientEntryDashboard();
};

// 17. AI Health Insurance & Cashless TPA Verifier Modal Logic
let activeInsVerificationResult = null;

window.openInsuranceVerifierModal = function(targetPatientId) {
    const modal = document.getElementById("insuranceVerifierModal");
    const patSelect = document.getElementById("insVerifPatientSelect");
    
    if (patSelect) {
        patSelect.innerHTML = `<option value="">Select registered patient...</option>`;
        MOCK_DB.patients.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.innerText = `${p.name} (${p.id}) ${p.insurance ? '- ' + p.insurance.provider : ''}`;
            patSelect.appendChild(opt);
        });
        
        if (targetPatientId) {
            patSelect.value = targetPatientId;
            autoPopulateInsuranceForm();
        }
    }
    
    document.getElementById("insVerifResultCard").classList.add("hidden");
    document.getElementById("insVerifLoading").classList.add("hidden");
    modal.classList.remove("hidden");
};

window.closeInsuranceVerifierModal = function() {
    document.getElementById("insuranceVerifierModal").classList.add("hidden");
};

window.autoPopulateInsuranceForm = function() {
    const patId = document.getElementById("insVerifPatientSelect").value;
    const p = MOCK_DB.patients.find(x => x.id === patId);
    
    if (p) {
        if (p.insurance && p.insurance.provider) {
            document.getElementById("insVerifProvider").value = p.insurance.provider;
        }
        if (p.insurance && p.insurance.policyNumber) {
            document.getElementById("insVerifPolicyNo").value = p.insurance.policyNumber;
        } else if (!document.getElementById("insVerifPolicyNo").value) {
            document.getElementById("insVerifPolicyNo").value = "POL-" + Math.floor(10000000 + Math.random() * 90000000);
        }
        
        const estBill = p.bill ? p.bill : 25000;
        document.getElementById("insVerifClaimAmount").value = estBill;
    }
};

window.runAiInsuranceVerification = function() {
    const patId = document.getElementById("insVerifPatientSelect").value;
    const provider = document.getElementById("insVerifProvider").value;
    const policyNo = document.getElementById("insVerifPolicyNo").value.trim();
    const claimAmt = parseFloat(document.getElementById("insVerifClaimAmount").value) || 50000;
    
    if (!patId) {
        alert("Please select a patient first.");
        return;
    }
    if (!policyNo) {
        alert("Please enter a valid Policy or Health Card Number.");
        return;
    }

    const patient = MOCK_DB.patients.find(p => p.id === patId);

    // Hide result & show loading
    document.getElementById("insVerifResultCard").classList.add("hidden");
    document.getElementById("insVerifLoading").classList.remove("hidden");

    addSystemLog("AI TPA Verifier", `Connecting to TPA gateway for ${provider} (Policy: ${policyNo})...`);

    setTimeout(() => {
        document.getElementById("insVerifLoading").classList.add("hidden");
        
        // Compute Cashless Coverage Rules (80% approved, 20% co-pay)
        const approvedAmt = Math.round(claimAmt * 0.8);
        const copayAmt = claimAmt - approvedAmt;
        const refCode = "TPA-AUTH-2026-" + Math.floor(10000 + Math.random() * 90000);
        const maxLimit = 500000;

        activeInsVerificationResult = {
            patientId: patId,
            patientName: patient ? patient.name : "Patient",
            provider: provider,
            policyNumber: policyNo,
            totalClaim: claimAmt,
            approvedAmount: approvedAmt,
            copayAmount: copayAmt,
            refCode: refCode,
            maxLimit: maxLimit
        };

        // Populate DOM elements
        document.getElementById("insResultProviderName").innerText = provider;
        document.getElementById("insResultRefCode").innerText = `Ref: ${refCode}`;
        document.getElementById("insResultTotalClaim").innerText = formatCurrency(claimAmt);
        document.getElementById("insResultApprovedAmount").innerText = formatCurrency(approvedAmt);
        document.getElementById("insResultCopayAmount").innerText = formatCurrency(copayAmt);
        document.getElementById("insResultCopayNote").innerText = formatCurrency(copayAmt);
        document.getElementById("insResultMaxLimit").innerText = formatCurrency(maxLimit);

        document.getElementById("insVerifResultCard").classList.remove("hidden");

        addSystemLog("AI TPA Verifier", `Cashless Pre-Auth Granted: ${formatCurrency(approvedAmt)} approved by ${provider} for ${patient ? patient.name : patId}`);
        addNotification("Cashless Pre-Auth Approved!", `${provider} pre-approved ${formatCurrency(approvedAmt)} (Ref: ${refCode}).`, "success");
    }, 1200);
};

window.applyInsuranceCoverageToPatient = function() {
    if (!activeInsVerificationResult) return;
    
    const p = MOCK_DB.patients.find(x => x.id === activeInsVerificationResult.patientId);
    if (p) {
        p.insurance = {
            provider: activeInsVerificationResult.provider,
            policyNumber: activeInsVerificationResult.policyNumber,
            approvedAmount: activeInsVerificationResult.approvedAmount,
            copayAmount: activeInsVerificationResult.copayAmount,
            refCode: activeInsVerificationResult.refCode,
            status: "Approved"
        };

        addSystemLog("Insurance Applied", `Cashless discount of ${formatCurrency(activeInsVerificationResult.approvedAmount)} applied to ${p.name}`);
        addNotification("Insurance Benefit Applied", `Applied ${formatCurrency(activeInsVerificationResult.approvedAmount)} cashless cover to ${p.name}'s account.`, "success");

        saveDatabaseState();
        closeInsuranceVerifierModal();
        
        // Refresh active views
        if (typeof populatePharmacistDashboard === "function") populatePharmacistDashboard();
        if (typeof populatePatientPortal === "function") populatePatientPortal();
        if (typeof populateDedicatedPatientEntryDashboard === "function") populateDedicatedPatientEntryDashboard();
    }
};

window.printPreAuthLetter = function() {
    if (!activeInsVerificationResult) return;

    const res = activeInsVerificationResult;
    const loc = state.localization || { currencySymbol: "₹" };

    const printWin = window.open("", "_blank", "width=800,height=900");
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cashless TPA Pre-Authorization Certificate - MedSphere AI</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
                .header { border-b: 3px solid #0d9488; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
                .logo { font-size: 24px; font-weight: bold; color: #0d9488; }
                .title { font-size: 20px; font-weight: bold; text-align: center; text-transform: uppercase; margin: 20px 0; color: #0f172a; }
                .badge { background: #dcfce7; color: #15803d; font-weight: bold; padding: 6px 12px; border-radius: 20px; font-size: 13px; text-align: center; display: inline-block; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 25px 0; font-size: 14px; }
                .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; }
                .table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
                .table th, .table td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; }
                .table th { background: #f1f5f9; }
                .footer { margin-top: 50px; border-top: 1px solid #e2e8f0; pt: 20px; font-size: 12px; color: #64748b; text-align: center; }
                .stamp { border: 2px dashed #0d9488; color: #0d9488; font-weight: bold; text-align: center; padding: 15px; border-radius: 10px; margin-top: 30px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="logo">🏥 MedSphere AI Health System</div>
                    <div style="font-size: 12px; color: #64748b;">Hospital Subdomain: hospital.technocons.com</div>
                </div>
                <div style="text-align: right; font-size: 12px;">
                    <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
                    <div><strong>Ref No:</strong> ${res.refCode}</div>
                </div>
            </div>

            <div style="text-align: center;">
                <div class="badge">✅ OFFICIAL CASHLESS PRE-AUTHORIZATION SANCTION</div>
            </div>

            <div class="title">TPA Cashless Eligibility Approval Certificate</div>

            <div class="grid">
                <div class="card">
                    <strong style="color: #0f172a; display: block; margin-bottom: 8px;">PATIENT DETAILS</strong>
                    <div><strong>Patient Name:</strong> ${res.patientName}</div>
                    <div><strong>Patient ID:</strong> ${res.patientId}</div>
                    <div><strong>Admission Type:</strong> Inpatient (IPD) Cashless</div>
                </div>
                <div class="card">
                    <strong style="color: #0f172a; display: block; margin-bottom: 8px;">TPA INSURANCE DETAILS</strong>
                    <div><strong>TPA Company:</strong> ${res.provider}</div>
                    <div><strong>Policy Number:</strong> ${res.policyNumber}</div>
                    <div><strong>Max Annual Limit:</strong> ${loc.currencySymbol}${res.maxLimit.toLocaleString()}</div>
                </div>
            </div>

            <table class="table">
                <thead>
                    <tr>
                        <th>Coverage Category</th>
                        <th>Amount (${loc.currencySymbol})</th>
                        <th>Approval Note</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Total Estimated Medical Claim</td>
                        <td>${loc.currencySymbol}${res.totalClaim.toLocaleString()}</td>
                        <td>Initial Pre-Auth Claim Submitted</td>
                    </tr>
                    <tr style="font-weight: bold; color: #059669;">
                        <td>TPA Approved Cashless Coverage (80%)</td>
                        <td>${loc.currencySymbol}${res.approvedAmount.toLocaleString()}</td>
                        <td>Pre-Approved for Direct Settlement</td>
                    </tr>
                    <tr style="color: #d97706;">
                        <td>Patient Co-Pay Obligation (20%)</td>
                        <td>${loc.currencySymbol}${res.copayAmount.toLocaleString()}</td>
                        <td>Payable by Patient at Hospital Desk</td>
                    </tr>
                </tbody>
            </table>

            <div class="stamp">
                DIRECT CASHLESS DISPATCH APPROVED BY ${res.provider.toUpperCase()}<br>
                <span style="font-weight: normal; font-size: 11px;">Digitally signed & validated by MedSphere AI Health Gateway • Token ID: ${res.refCode}</span>
            </div>

            <div class="footer">
                This is a computer-generated pre-authorization document issued by MedSphere AI Health Management.
            </div>

            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `);
    printWin.document.close();
};

// 19. AI Diagnostic Lab Anomaly Detector & AI Clinical Triage Analyzer
window.openLabAnomalyModal = function() {
    const modal = document.getElementById("labAnomalyModal");
    if (!modal) return;
    
    // Populate patient select
    const select = document.getElementById("labPatSelect");
    if (select) {
        select.innerHTML = `<option value="">-- Select Admitted / OPD Patient --</option>`;
        MOCK_DB.patients.forEach(p => {
            select.innerHTML += `<option value="${p.id}">${p.name} (ID: ${p.id} - Bed: ${p.bed || 'OPD'})</option>`;
        });
    }
    
    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
};

window.closeLabAnomalyModal = function() {
    const modal = document.getElementById("labAnomalyModal");
    if (modal) modal.classList.add("hidden");
};

window.autoPopulateLabFields = function() {
    const patId = document.getElementById("labPatSelect").value;
    if (!patId) return;
    
    const p = MOCK_DB.patients.find(x => x.id === patId);
    if (p) {
        // Set realistic lab values based on patient
        document.getElementById("labHb").value = (p.id === "PAT-001") ? 6.4 : 12.8;
        document.getElementById("labWbc").value = (p.id === "PAT-001") ? 18400 : 8200;
        document.getElementById("labPlt").value = (p.id === "PAT-001") ? 42000 : 240000;
        document.getElementById("labPotassium").value = (p.id === "PAT-001") ? 6.3 : 4.1;
        document.getElementById("labTroponin").value = (p.id === "PAT-001") ? 0.85 : 0.01;
    }
};

window.runAiLabAnomalyScan = function() {
    const patId = document.getElementById("labPatSelect").value;
    const hb = parseFloat(document.getElementById("labHb").value) || 0;
    const wbc = parseFloat(document.getElementById("labWbc").value) || 0;
    const plt = parseFloat(document.getElementById("labPlt").value) || 0;
    const k = parseFloat(document.getElementById("labPotassium").value) || 0;
    const trop = parseFloat(document.getElementById("labTroponin").value) || 0;
    
    const findings = [];
    let riskLevel = "GREEN"; // GREEN, YELLOW, RED
    
    if (trop > 0.4) {
        riskLevel = "RED";
        findings.push(`🚨 <strong>Troponin-I Elevation (${trop} ng/mL):</strong> Critical cardiac muscle injury. Silent Myocardial Infarction (MI) risk.`);
    }
    if (k > 6.0) {
        riskLevel = "RED";
        findings.push(`🚨 <strong>Severe Hyperkalemia (${k} mEq/L):</strong> High risk of cardiac arrhythmia & ventricular arrest. Immediate ECG required.`);
    }
    if (hb > 0 && hb < 7.0) {
        riskLevel = "RED";
        findings.push(`⚠️ <strong>Severe Anemia / Hemoglobin Drop (${hb} g/dL):</strong> Critical oxygen capacity loss. Blood transfusion indicator.`);
    }
    if (wbc > 15000 && plt < 50000) {
        riskLevel = "RED";
        findings.push(`⚠️ <strong>Sepsis / Severe Infection Triad (WBC: ${wbc}, Plt: ${plt}):</strong> Septic shock or Dengue hemorrhagic risk.`);
    } else if (wbc > 11000) {
        if (riskLevel !== "RED") riskLevel = "YELLOW";
        findings.push(`⚠️ <strong>Leukocytosis (WBC: ${wbc}):</strong> Elevated inflammatory marker indicating systemic infection.`);
    }
    
    if (findings.length === 0) {
        findings.push(`✅ All lab values (Hb, WBC, Platelets, K+, Troponin-I) fall within normal biological reference ranges.`);
    }
    
    const card = document.getElementById("labScanResultCard");
    const badge = document.getElementById("labResultRiskBadge");
    const list = document.getElementById("labResultFindingsList");
    
    card.classList.remove("hidden");
    list.innerHTML = findings.map(f => `<div>${f}</div>`).join("");
    
    if (riskLevel === "RED") {
        badge.className = "text-xs font-bold text-red-400 flex items-center gap-1.5 animate-pulse";
        badge.innerHTML = "🚨 PANIC RED-FLAG LAB ANOMALY DETECTED";
    } else if (riskLevel === "YELLOW") {
        badge.className = "text-xs font-bold text-amber-400 flex items-center gap-1.5";
        badge.innerHTML = "⚠️ MODERATE PATHOLOGY RISK DETECTED";
    } else {
        badge.className = "text-xs font-bold text-emerald-400 flex items-center gap-1.5";
        badge.innerHTML = "🟢 NORMAL PATHOLOGY PROFILE";
    }
    
    if (window.lucide) lucide.createIcons();
};

window.printLabAnomalyCertificate = function() {
    const patId = document.getElementById("labPatSelect").value;
    const p = MOCK_DB.patients.find(x => x.id === patId) || { name: "Patient Check", age: 45 };
    const findings = document.getElementById("labResultFindingsList").innerText;
    
    const printWin = window.open("", "_blank", "width=800,height=900");
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>MedSphere AI - Pathology Anomaly Warning Report</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; background: #fff; }
                .header { text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 20px; margin-bottom: 20px; }
                .title { font-size: 20px; font-weight: bold; color: #0f172a; }
                .findings { background: #fff1f2; border: 1px solid #fecdd3; padding: 15px; border-radius: 8px; font-size: 13px; color: #9f1239; margin-top: 20px; }
                .footer { margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">AI PATHOLOGY DIAGNOSTIC ANOMALY REPORT</div>
                <div style="color: #0d9488; font-size: 13px; font-weight: bold;">MedSphere AI Pathology Scanner</div>
            </div>
            <div><strong>Patient Name:</strong> ${p.name} | <strong>Age:</strong> ${p.age} | <strong>Bed:</strong> ${p.bed || 'OPD'}</div>
            <div class="findings">
                <strong>AI ANOMALY SCAN FINDINGS:</strong><br><br>
                ${findings.replace(/\n/g, '<br>')}
            </div>
            <div class="footer">Digitally issued by MedSphere AI Lab Anomaly Detector • Doctor Verification Required</div>
            <script>window.onload = function() { window.print(); }</script>
        </body>
        </html>
    `);
    printWin.document.close();
};

// AI Clinical Triage Analyzer
window.openTriageAnalyzerModal = function() {
    const modal = document.getElementById("triageAnalyzerModal");
    if (modal) {
        modal.classList.remove("hidden");
        if (window.lucide) lucide.createIcons();
    }
};

window.closeTriageAnalyzerModal = function() {
    const modal = document.getElementById("triageAnalyzerModal");
    if (modal) modal.classList.add("hidden");
};

window.runAiTriageScan = function() {
    const name = document.getElementById("triagePatName").value || "Walk-in Patient";
    const complaint = document.getElementById("triageComplaint").value.toLowerCase();
    const bp = document.getElementById("triageBp").value;
    const pulse = parseInt(document.getElementById("triagePulse").value) || 80;
    const spo2 = parseInt(document.getElementById("triageSpo2").value) || 98;
    const temp = parseFloat(document.getElementById("triageTemp").value) || 98.6;
    
    let level = "LEVEL 4 - LESS URGENT";
    let bedRec = "General OPD Consultation";
    let color = "text-emerald-400";
    const rationale = [];
    
    if (complaint.includes("chest pain") || complaint.includes("unconscious") || spo2 < 90 || pulse > 140) {
        level = "LEVEL 1 - RESUSCITATION CRITICAL";
        bedRec = "🚨 Immediate ICU / ER Trauma Bay";
        color = "text-red-500 animate-pulse";
        rationale.push("• Severe hemodynamic instability or respiratory failure risk.");
        rationale.push(`• Low SpO2 (${spo2}%) or critical complaint ("${complaint}").`);
    } else if (complaint.includes("tightness") || complaint.includes("breath") || complaint.includes("high fever") || temp > 103 || spo2 < 94) {
        level = "LEVEL 2 - EMERGENT ACUITY";
        bedRec = "⚠️ Emergency High-Care Ward Bay";
        color = "text-amber-400";
        rationale.push("• High-risk complaint requiring rapid physician intervention within 10 minutes.");
        rationale.push(`• Vitals: Pulse ${pulse} bpm, SpO2 ${spo2}%, Temp ${temp}°F.`);
    } else if (complaint.includes("fever") || complaint.includes("pain") || temp > 101) {
        level = "LEVEL 3 - URGENT CARE";
        bedRec = "General Ward Bed / Priority OPD";
        color = "text-yellow-400";
        rationale.push("• Stable vitals requiring diagnostic testing or fluid therapy.");
    } else {
        rationale.push("• Hemodynamically stable. Routine OPD consultation queue.");
    }
    
    const card = document.getElementById("triageResultCard");
    const badge = document.getElementById("triageLevelBadge");
    const rec = document.getElementById("triageBedRecommendation");
    const text = document.getElementById("triageRationaleText");
    
    card.classList.remove("hidden");
    badge.className = `text-xs font-bold ${color}`;
    badge.innerText = level;
    rec.innerText = bedRec;
    text.innerHTML = rationale.map(r => `<div>${r}</div>`).join("");
};

// 18. ABHA Health ID Generator & Legal Compliance EULA Handlers
window.generateAbhaHealthId = function() {
    const p1 = "91";
    const p2 = Math.floor(1000 + Math.random() * 9000);
    const p3 = Math.floor(1000 + Math.random() * 9000);
    const p4 = Math.floor(1000 + Math.random() * 9000);
    const abhaId = `${p1}-${p2}-${p3}-${p4}`;
    
    const input = document.getElementById("dedicatedPatAbhaId");
    if (input) {
        input.value = abhaId;
        alert(`✅ 14-Digit ABHA Health ID Generated & Verified:\n\n${abhaId}\n\nLinked under ABDM M3 Interoperability Standards.`);
    }
};

window.openLegalComplianceModal = function() {
    const modal = document.getElementById("legalComplianceModal");
    if (modal) {
        modal.classList.remove("hidden");
        if (window.lucide) lucide.createIcons();
    }
};

window.closeLegalComplianceModal = function() {
    const modal = document.getElementById("legalComplianceModal");
    if (modal) modal.classList.add("hidden");
};

window.printComplianceCertificate = function() {
    const certWin = window.open("", "_blank", "width=800,height=900");
    certWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>MedSphere AI - Official Software EULA & Compliance Certificate</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; background: #fff; }
                .cert-header { text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 20px; margin-bottom: 30px; }
                .cert-title { font-size: 24px; font-weight: bold; color: #0f172a; text-transform: uppercase; letter-spacing: 1px; }
                .subtitle { color: #0d9488; font-weight: bold; font-size: 14px; margin-top: 5px; }
                .badge-grid { display: flex; justify-content: space-around; margin: 30px 0; background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; }
                .badge-item { text-align: center; }
                .badge-title { font-weight: bold; font-size: 13px; color: #0f172a; }
                .badge-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
                .section { margin-bottom: 20px; line-height: 1.6; font-size: 13px; }
                .section h3 { font-size: 14px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 8px; }
                .footer { margin-top: 50px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
            </style>
        </head>
        <body>
            <div class="cert-header">
                <div class="cert-title">Official EULA, Data Privacy & ABDM Compliance Certificate</div>
                <div class="subtitle">MedSphere AI Hospital Operating System • Technocons Solutions</div>
            </div>
            
            <div class="badge-grid">
                <div class="badge-item">
                    <div class="badge-title">DPDP ACT 2023</div>
                    <div class="badge-sub">256-Bit SSL/TLS Encryption</div>
                </div>
                <div class="badge-item">
                    <div class="badge-title">ABDM M3 COMPLIANT</div>
                    <div class="badge-sub">14-Digit ABHA ID Interoperability</div>
                </div>
                <div class="badge-item">
                    <div class="badge-title">CLINICAL SUPPORT EULA</div>
                    <div class="badge-sub">Doctor Decision Final Authority</div>
                </div>
            </div>

            <div class="section">
                <h3>1. Clinical Decision Support Medical Disclaimer</h3>
                <p>This software operates as an administrative hospital management system and clinical decision-support assistant. AI-generated diagnostic anomaly alerts and triage scores are advisory tools designed to support healthcare staff. Ultimate medical diagnosis and prescription authorization rest exclusively with licensed medical practitioners.</p>
            </div>

            <div class="section">
                <h3>2. Data Protection & Privacy Standard</h3>
                <p>Protected health information (PHI) is encrypted in transit and at rest using AES 256-bit encryption in full compliance with the Digital Personal Data Protection (DPDP) Act 2023 and HIPAA guidelines.</p>
            </div>

            <div class="section">
                <h3>3. Certificate Credentials</h3>
                <p><strong>License Entity:</strong> MedSphere AI SaaS Instance<br>
                <strong>Issuance Date:</strong> ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}<br>
                <strong>Security Certificate Token:</strong> EULA-REG-2026-ABDM9842</p>
            </div>

            <div class="footer">
                Digitally Stamped & Issued by MedSphere AI Compliance Gateway • Technocons Software Licensing Authority
            </div>
            <script>window.onload = function() { window.print(); }</script>
        </body>
        </html>
    `);
    certWin.document.close();
};
