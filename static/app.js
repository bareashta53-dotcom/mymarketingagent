// Utility to parse money
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
};

// Fetch insights on load
document.addEventListener("DOMContentLoaded", () => {
    fetchInsights();
});

async function fetchInsights() {
    const campaignId = document.getElementById('campaignId').value;
    const statusMsg = document.getElementById('statusMessage');

    if (!campaignId) {
        statusMsg.innerHTML = '<span class="error-text">אנא הזן מזהה קמפיין תקין (ID)</span>';
        return;
    }

    try {
        statusMsg.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> טוען נתונים מפייסבוק...</span>';

        const response = await fetch(`/insights/${campaignId}`);
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
                'Content-Type': 'application/json'
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

// AI Copywriter
async function generateAICopy() {
    const aiInput = document.getElementById('aiInput').value;
    if (!aiInput) {
        alert("נא להזין תיאור קצר של המוצר לפני בקשת ניסוח מה-AI.");
        return;
    }

    const aiBtn = document.getElementById('aiBtn');
    aiBtn.disabled = true;
    aiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> חושב...';

    try {
        const response = await fetch('/api/generate-copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_description: aiInput })
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            document.getElementById('wizHeadline').value = data.copy.headline;
            document.getElementById('wizPrimaryText').value = data.copy.primary_text;

            // Add a little success animation or text if needed
            aiBtn.innerHTML = '<i class="fa-solid fa-check"></i> נוסח בהצלחה!';
            setTimeout(() => {
                aiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> נסה לנסח שוב';
                aiBtn.disabled = false;
            }, 3000);
        } else {
            throw new Error(data.detail || "שגיאה ביצירת הטקסט");
        }
    } catch (error) {
        alert("שגיאת AI: " + error.message);
        aiBtn.disabled = false;
        aiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> נסה לנסח שוב';
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

    const countriesElement = document.getElementById('wizCountries');
    const countries = Array.from(countriesElement.selectedOptions).map(opt => opt.value);

    if (!uploadedImageHash || !headline || !text || !url || isNaN(budget) || countries.length === 0) {
        feedback.innerHTML = '<span class="error-text">חסרים נתונים או שהתקציב אינו תקין. נא לבדוק את כל השלבים עמודי האשף.</span>';
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> בונה את הקמפיין (זה ייקח כמה שניות)...';
        feedback.innerHTML = '';

        const payload = {
            name: name,
            daily_budget_dollars: budget,
            countries: countries,
            primary_text: text,
            headline: headline,
            link_url: url,
            image_hash: uploadedImageHash
        };

        const response = await fetch(`/api/publish-campaign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
