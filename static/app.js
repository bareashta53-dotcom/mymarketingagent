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
        statusMsg.innerHTML = '<span class="error-text">Please enter a Campaign ID</span>';
        return;
    }

    try {
        statusMsg.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> Fetching Data...</span>';

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

            statusMsg.innerHTML = '<span class="success-text"><i class="fa-solid fa-check"></i> Data Updated</span>';
        } else {
            // Handle if there's no data yet (like a new campaign)
            if (data.message) {
                statusMsg.innerHTML = `<span class="error-text">${data.message}</span>`;
            } else {
                throw new Error(data.detail?.error?.message || "Failed to fetch data");
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
        feedbackMsg.innerHTML = '<span class="error-text">Invalid Campaign ID or Budget Amount.</span>';
        return;
    }

    try {
        feedbackMsg.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> Updating Budget on Meta...</span>';

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
            feedbackMsg.innerHTML = `<span class="success-text"><i class="fa-solid fa-circle-check"></i> ${data.message}</span>`;
        } else {
            throw new Error(data.detail?.error?.message || "Failed to update budget");
        }
    } catch (error) {
        feedbackMsg.innerHTML = `<span class="error-text"><i class="fa-solid fa-circle-xmark"></i> ${error.message}</span>`;
    }
}
