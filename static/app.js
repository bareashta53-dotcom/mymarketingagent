// -----------------------------------------------------
// AGENCY MODE (Auth Headers)
// -----------------------------------------------------

function getAuthHeaders() {
    const headers = {};
    const adAccountId = localStorage.getItem('botito_ad_account_id');
    const accessToken = localStorage.getItem('botito_access_token');

    if (adAccountId) {
        headers['X-Meta-Ad-Account-Id'] = adAccountId;
    }
    if (accessToken) {
        headers['X-Meta-Access-Token'] = accessToken;
    }
    return headers;
}

// Fetch insights on load
document.addEventListener("DOMContentLoaded", () => {
    loadAgencySettings();
    fetchInsights();
});

function loadAgencySettings() {
    const defaultAcc = localStorage.getItem('botito_ad_account_id');
    const disp = document.getElementById('activeClientDisplay');
    if (defaultAcc) {
        disp.innerText = `לקוח: ${defaultAcc}`;
    } else {
        disp.innerText = 'לקוח: ברירת מחדל (שרת)';
    }
}

function openSettingsModal() {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('agencyAdAccountId').value = localStorage.getItem('botito_ad_account_id') || '';
    document.getElementById('agencyAccessToken').value = localStorage.getItem('botito_access_token') || '';
    document.getElementById('settingsFeedback').innerHTML = '';
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function saveAgencySettings() {
    const accId = document.getElementById('agencyAdAccountId').value.trim();
    const token = document.getElementById('agencyAccessToken').value.trim();

    if (accId) {
        localStorage.setItem('botito_ad_account_id', accId);
    } else {
        localStorage.removeItem('botito_ad_account_id');
    }

    if (token) {
        localStorage.setItem('botito_access_token', token);
    } else {
        localStorage.removeItem('botito_access_token');
    }

    loadAgencySettings();
    document.getElementById('settingsFeedback').innerHTML = '<span class="success-text"><i class="fa-solid fa-check"></i> נשמר בהצלחה!</span>';

    // Refresh insights automatically for the new client
    setTimeout(() => {
        closeSettingsModal();
        fetchInsights();
    }, 1500);
}

// Utility to parse money
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
};

async function fetchInsights() {
    const campaignId = document.getElementById('campaignId').value;
    const statusMsg = document.getElementById('statusMessage');

    if (!campaignId) {
        statusMsg.innerHTML = '<span class="error-text">אנא הזן מזהה קמפיין תקין (ID)</span>';
        return;
    }

    try {
        statusMsg.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> טוען נתונים מפייסבוק...</span>';

        const response = await fetch(`/insights/${campaignId}`, {
            headers: {
                ...getAuthHeaders()
            }
        });
        const data = await response.json();

        if (response.ok && data.status === 'success') {
            const insights = data.insights;

            // Update KPIs
            document.getElementById('kpi-spend').innerText = formatCurrency(insights.spend || 0);
            document.getElementById('kpi-impressions').innerText = parseInt(insights.impressions || 0).toLocaleString();
            document.getElementById('kpi-clicks').innerText = parseInt(insights.clicks || 0).toLocaleString();

            const ctr = parseFloat(insights.ctr || 0).toFixed(2);
            document.getElementById('kpi-ctr').innerText = `${ctr}%`;

            statusMsg.innerHTML = '<span class="success-text"><i class="fa-solid fa-check"></i> הנתונים עודכנו</span>';
        } else {
            // Handle if there's no data yet (like a new campaign)
            if (data.message) {
                statusMsg.innerHTML = `<span class="error-text">${data.message}</span>`;
            } else {
                throw new Error(data.detail?.error?.message || "שגיאה בטעינת נתונים");
            }
        }
    } catch (error) {
        statusMsg.innerHTML = `<span class="error-text"><i class="fa-solid fa-triangle-exclamation"></i> ${error.message}</span>`;
    }
}

async function updateBudget() {
    const campaignId = document.getElementById('campaignId').value;
    const budgetValue = document.getElementById('budgetInput').value;
    const feedbackMsg = document.getElementById('actionFeedback');

    if (!campaignId || !budgetValue || budgetValue <= 0) {
        feedbackMsg.innerHTML = '<span class="error-text">מזהה קמפיין או סכום תקציב אינם תקינים.</span>';
        return;
    }

    try {
        feedbackMsg.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> מעדכן תקציב במערכות פייסבוק...</span>';

        const response = await fetch(`/update-budget`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({
                campaign_id: campaignId,
                daily_budget_dollars: parseFloat(budgetValue)
            })
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            feedbackMsg.innerHTML = `<span class="success-text"><i class="fa-solid fa-circle-check"></i> התקציב עודכן בהצלחה!</span>`;
        } else {
            throw new Error(data.detail?.error?.message || "שגיאה בעדכון התקציב");
        }
    } catch (error) {
        feedbackMsg.innerHTML = `<span class="error-text"><i class="fa-solid fa-circle-xmark"></i> ${error.message}</span>`;
    }
}

// -----------------------------------------------------
// WIZARD LOGIC
// -----------------------------------------------------

let uploadedImageHash = null;

function openWizard() {
    document.getElementById('wizardModal').classList.remove('hidden');
    // Reset steps
    showStep(1);
    document.getElementById('wizardFeedback').innerHTML = '';

    // Auto-fetch available Facebook pages for Step 3
    fetchFacebookPages();

    // Attach click listeners to step indicators
    document.querySelectorAll('.wizard-steps .step').forEach((el, index) => {
        el.onclick = () => {
            // Navigation is now unlocked
            showStep(index + 1);
        };
    });
}

function closeWizard() {
    document.getElementById('wizardModal').classList.add('hidden');
}

function nextStep(currentStep) {
    // Navigation is now unlocked
    showStep(currentStep + 1);
}

function prevStep(currentStep) {
    showStep(currentStep - 1);
}

function showStep(stepNumber) {
    // Hide all
    document.querySelectorAll('.wizard-pane').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.wizard-steps .step').forEach(el => el.classList.remove('active'));

    // Show target
    document.getElementById(`wizard-step-${stepNumber}`).classList.remove('hidden');
    document.getElementById(`step-indicator-${stepNumber}`).classList.add('active');
}

// Fetch user's Facebook Pages
async function fetchFacebookPages() {
    const pageSelect = document.getElementById('wizPageSelect');

    try {
        const response = await fetch('/api/facebook-pages', {
            headers: {
                ...getAuthHeaders()
            }
        });
        const data = await response.json();

        if (response.ok && data.status === 'success') {
            const pages = data.pages;

            if (pages.length === 0) {
                pageSelect.innerHTML = '<option value="" disabled selected>לא נמצאו עמודים המשוייכים לחשבון זה</option>';
                return;
            }

            // Populate Dropdown
            pageSelect.innerHTML = '<option value="" disabled selected>-- בחר עמוד --</option>';
            pages.forEach(page => {
                const option = document.createElement('option');
                option.value = page.id;
                option.textContent = page.name;
                pageSelect.appendChild(option);
            });

        } else {
            console.error("Error fetching pages:", data.detail);
            pageSelect.innerHTML = '<option value="" disabled selected>שגיאה בטעינת עמודים</option>';
        }
    } catch (error) {
        console.error("Network error fetching pages:", error);
        pageSelect.innerHTML = '<option value="" disabled selected>שגיאת תקשורת בטעינה</option>';
    }
}

// Global state for AI output
window.aiTargetingData = null;

async function analyzeTargeting() {
    const prodDesc = document.getElementById('wizProductDesc').value;
    const audDesc = document.getElementById('wizAudienceDesc').value;
    const budDesc = document.getElementById('wizBudgetDesc').value;

    if (!prodDesc || !audDesc) {
        alert("נא למלא לפחות את תיאור המוצר והקהל (שאלות 1 ו-2).");
        return;
    }

    const aiBtn = document.getElementById('aiAnalyzeBtn');
    const loadingFeedback = document.getElementById('aiLoadingFeedback');

    aiBtn.disabled = true;
    loadingFeedback.classList.remove('hidden');

    try {
        const response = await fetch('/api/analyze-targeting', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({
                product_desc: prodDesc,
                audience_desc: audDesc,
                budget_desc: budDesc || "לא צוין"
            })
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            const ai = data.analysis;
            window.aiTargetingData = ai; // Save to global state

            // Populate Step 3 inputs
            document.getElementById('wizHeadline').value = ai.headline || "";
            document.getElementById('wizPrimaryText').value = ai.primary_text || "";
            if (ai.daily_budget_dollars) {
                document.getElementById('wizBudget').value = ai.daily_budget_dollars;
            }

            // Populate the AI Summary Card
            const citiesStr = ai.geo_locations?.cities?.join(", ") || "כל הארץ";
            const countriesStr = ai.geo_locations?.countries?.join(", ") || "ישראל";

            document.getElementById('aiSummaryCard').innerHTML = `
                <ul>
                    <li><i class="fa-solid fa-earth-americas"></i> <b>מדינות:</b> ${countriesStr}</li>
                    <li><i class="fa-solid fa-city"></i> <b>ערים מאותרות:</b> ${citiesStr}</li>
                    <li><i class="fa-solid fa-users"></i> <b>גילאים:</b> ${ai.min_age} עד ${ai.max_age}</li>
                    <li><i class="fa-solid fa-coins"></i> <b>תקציב התחלתי מומלץ הוגדר:</b> $${ai.daily_budget_dollars}/יום</li>
                </ul>
                <p style="margin-top: 10px; font-size: 0.85rem; color: #64748b;">(ה-AI שתל את נתוני הקופירייטינג והתקציב בשדות למטה. אנא הוסף רק קישור ולחץ "צור קמפיין")</p>
            `;

            // Auto-advance to step 3
            nextStep(2);
        } else {
            throw new Error(data.detail || "שגיאה בניתוח הנתונים");
        }
    } catch (error) {
        alert("שגיאת AI: " + error.message);
    } finally {
        aiBtn.disabled = false;
        loadingFeedback.classList.add('hidden');
    }
}

// Drag and Drop Logic
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect({ target: fileInput });
    }
});

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Show preview name
    const preview = document.getElementById('filePreview');
    preview.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> מעלה את: ${file.name}...`;
    preview.classList.remove('hidden');

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch('/api/upload-media', {
            method: 'POST',
            headers: {
                ...getAuthHeaders()
            },
            body: formData
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            uploadedImageHash = data.hash;
            preview.innerHTML = `<i class="fa-solid fa-check text-success"></i> התמונה עלתה בהצלחה`;
        } else {
            throw new Error(data.detail?.error?.message || "שגיאה בהעלאה");
        }
    } catch (error) {
        preview.innerHTML = `<span class="error-text"><i class="fa-solid fa-triangle-exclamation"></i> ${error.message}</span>`;
        uploadedImageHash = null;
    }
}

async function publishCampaign() {
    const btn = document.getElementById('publishAdBtn');
    const feedback = document.getElementById('wizardFeedback');

    const name = document.getElementById('wizCampaignName').value || 'קמפיין אוטומטי';
    const headline = document.getElementById('wizHeadline').value;
    const text = document.getElementById('wizPrimaryText').value;
    const url = document.getElementById('wizLink').value;
    const budget = parseFloat(document.getElementById('wizBudget').value);
    const pageId = document.getElementById('wizPageSelect').value;

    if (!uploadedImageHash || !headline || !text || !url || isNaN(budget) || !window.aiTargetingData || !pageId) {
        feedback.innerHTML = '<span class="error-text">חסרים נתונים מקדימים (תמונה, URL), לא נבחר עמוד פייסבוק, או שטרם בוצע ניתוח AI על ידי אשף "הראיון".</span>';
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> בונה קמפיין מטורף (זה ייקח כמה שניות)...';
        feedback.innerHTML = '';

        // Overwrite the specific dynamic fields the AI created with the possibly user-edited values from the UI
        window.aiTargetingData.headline = headline;
        window.aiTargetingData.primary_text = text;
        window.aiTargetingData.daily_budget_dollars = budget;

        const payload = {
            name: name,
            daily_budget_dollars: budget,
            targeting_json: window.aiTargetingData,
            primary_text: text,
            headline: headline,
            link_url: url,
            image_hash: uploadedImageHash,
            page_id: pageId
        };

        const response = await fetch(`/api/publish-campaign`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            feedback.innerHTML = `
                <div class="summary-box">
                    <h3 class="success-text"><i class="fa-solid fa-party-horn"></i> מזל טוב!</h3>
                    <p>הקמפיין נוצר בהצלחה ונמצא תחת מזהה: <b>${data.campaign_id}</b></p>
                    <p>כזכור, הקמפיין כרגע בסטטוס "מושהה" במנהל המודעות. היכנס לפייסבוק להפעלתו.</p>
                </div>
            `;
            // Set the main dashboard value to the new ID
            document.getElementById('campaignId').value = data.campaign_id;
            // Clear hash so a new one is required for the next campaign
            uploadedImageHash = null;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> יצירה הושלמה';
        } else {
            throw new Error(data.detail?.error?.message || data.detail || "שגיאה ביצירת הקמפיין");
        }
    } catch (error) {
        feedback.innerHTML = `<span class="error-text"><i class="fa-solid fa-circle-xmark"></i> ${error.message}</span>`;
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rocket"></i> נסה ליצור שוב';
    }
}
