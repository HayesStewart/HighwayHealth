document.addEventListener('DOMContentLoaded', async () => {
    // --- HERO SECTION LOGIC ---
    const heroRadius = document.getElementById('heroRadius');
    const heroRadiusVal = document.getElementById('heroRadiusVal');
    const heroLimit = document.getElementById('heroLimit');
    const heroLimitVal = document.getElementById('heroLimitVal');
    const goBtn = document.getElementById('goToDashboardBtn');

    heroRadius.addEventListener('input', (e) => {
        heroRadiusVal.textContent = e.target.value;
    });
    heroLimit.addEventListener('input', (e) => {
        heroLimitVal.textContent = e.target.value;
    });

    goBtn.addEventListener('click', () => {
        const r = heroRadius.value;
        const l = heroLimit.value;
        window.location.href = `dashboard.html?radius=${r}&limit=${l}`;
    });

    // --- CAROUSEL LOGIC ---
    const dbSearch = document.getElementById('dbSearch');
    const prevBtn = document.getElementById('prevRestBtn');
    const nextBtn = document.getElementById('nextRestBtn');
    const cardContainer = document.getElementById('restaurantCard');
    const counterDisplay = document.getElementById('counterDisplay');
    const cleanStatus = document.getElementById('cleanStatus');

    let restaurants = [];
    let currentIndex = 0;

    // --- AUTO CLEANUP ON LAUNCH ---
    try {
        console.log("Starting auto-cleanup...");
        cleanStatus.textContent = "Cleaning database...";
        
        const cleanRes = await fetch('/api/cleanup', { method: 'DELETE' });
        const cleanData = await cleanRes.json();
        
        console.log(`Cleanup complete. Removed ${cleanData.itemsRemoved} items and ${cleanData.restaurantsRemoved} empty restaurants.`);
        cleanStatus.textContent = "Database optimized.";
        
        // Hide status after 3 seconds
        setTimeout(() => { cleanStatus.textContent = ""; }, 3000);
    } catch (err) {
        console.error("Auto-cleanup failed:", err);
        cleanStatus.textContent = "Cleanup failed (Server Error)";
    }

    // --- FETCH DATA (After Cleanup) ---
    fetchRestaurants("");

    // Search Listener
    dbSearch.addEventListener('input', (e) => {
        const term = e.target.value;
        fetchRestaurants(term);
    });

    // Navigation Listeners
    prevBtn.addEventListener('click', () => {
        if (restaurants.length === 0) return;
        currentIndex--;
        if (currentIndex < 0) {
            currentIndex = restaurants.length - 1; 
        }
        renderCurrentCard();
    });

    nextBtn.addEventListener('click', () => {
        if (restaurants.length === 0) return;
        currentIndex++;
        if (currentIndex >= restaurants.length) {
            currentIndex = 0; 
        }
        renderCurrentCard();
    });

    async function fetchRestaurants(searchTerm) {
        try {
            const query = encodeURIComponent(searchTerm);
            const response = await fetch(`/api/browse?search=${query}`);
            const data = await response.json();
            
            restaurants = data;
            currentIndex = 0; 
            renderCurrentCard();
        } catch (error) {
            console.error("Failed to load restaurants", error);
            cardContainer.innerHTML = '<div class="empty-state">Error loading data.</div>';
        }
    }

    function renderCurrentCard() {
        if (restaurants.length === 0) {
            cardContainer.innerHTML = '<div class="empty-state">No restaurants found.</div>';
            counterDisplay.textContent = "";
            return;
        }

        const data = restaurants[currentIndex];
        counterDisplay.textContent = `${currentIndex + 1} / ${restaurants.length}`;

        let menuHtml = '';
        if (data.servings && data.servings.length > 0) {
            menuHtml = data.servings.map(item => `
                <div class="menu-item-row">
                    <div class="menu-item-name">${item.food_name}</div>
                    <div class="menu-item-stats">
                        ${item.protein}g P / ${item.calories} Cal
                    </div>
                </div>
            `).join('');
        } else {
            menuHtml = '<p style="text-align:center; color:#999;">No menu items available.</p>';
        }

        cardContainer.innerHTML = `
            <div class="frame-header">
                <h2>${data.restaurant}</h2>
            </div>
            <div class="frame-body">
                ${menuHtml}
            </div>
        `;
    }
});