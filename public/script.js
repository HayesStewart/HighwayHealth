document.addEventListener('DOMContentLoaded', async () => {
    // --- HERO SECTION LOGIC (Passing settings to the Dashboard) ---
    const heroRadius = document.getElementById('heroRadius');
    const heroRadiusVal = document.getElementById('heroRadiusVal');
    const heroLimit = document.getElementById('heroLimit');
    const heroLimitVal = document.getElementById('heroLimitVal');
    const goBtn = document.getElementById('goToDashboardBtn');

    // Update the slider text immediately as the user moves it
    heroRadius.addEventListener('input', (e) => { heroRadiusVal.textContent = e.target.value; });
    heroLimit.addEventListener('input', (e) => { heroLimitVal.textContent = e.target.value; });

    // When the 'Find Results' button is clicked, navigate to the dashboard 
    // and pass the radius and limit settings through the URL
    goBtn.addEventListener('click', () => {
        const r = heroRadius.value;
        const l = heroLimit.value;
        window.location.href = `dashboard.html?radius=${r}&limit=${l}`;
    });

    // --- CAROUSEL AND DATABASE BROWSER LOGIC ---
    const dbSearch = document.getElementById('dbSearch');
    const prevBtn = document.getElementById('prevRestBtn');
    const nextBtn = document.getElementById('nextRestBtn');
    const cardContainer = document.getElementById('restaurantCard');
    const counterDisplay = document.getElementById('counterDisplay');
    const cleanStatus = document.getElementById('cleanStatus');

    let restaurants = [];
    let currentIndex = 0;

    // --- AUTO CLEANUP ON LAUNCH ---
    // When the page loads, I automatically clean up old or blank menu entries in my database 
    // to keep the data fresh and accurate before starting the carousel.
    try {
        console.log("Starting automatic database cleanup...");
        cleanStatus.textContent = "Cleaning database...";
        
        const cleanRes = await fetch('/api/cleanup', { method: 'DELETE' });
        const cleanData = await cleanRes.json();
        
        console.log(`Cleanup complete. Removed ${cleanData.itemsRemoved} bad items and ${cleanData.restaurantsRemoved} empty restaurants.`);
        cleanStatus.textContent = "Database optimized.";
        
        // Hide the status message after a few seconds
        setTimeout(() => { cleanStatus.textContent = ""; }, 3000);
    } catch (err) {
        console.error("Automatic cleanup failed:", err);
        cleanStatus.textContent = "Cleanup failed (Server Error)";
    }

    // --- FETCH DATA (After Cleanup) ---
    fetchRestaurants("");

    // Search Listener: When the user types, I fetch matching restaurant names from my server
    dbSearch.addEventListener('input', (e) => {
        const term = e.target.value;
        fetchRestaurants(term);
    });

    // Navigation Listeners: Cycle through the list of restaurants
    prevBtn.addEventListener('click', () => {
        if (restaurants.length === 0) return;
        currentIndex--;
        if (currentIndex < 0) {
            currentIndex = restaurants.length - 1; // Loop back to the end
        }
        renderCurrentCard();
    });

    nextBtn.addEventListener('click', () => {
        if (restaurants.length === 0) return;
        currentIndex++;
        if (currentIndex >= restaurants.length) {
            currentIndex = 0; // Loop back to the start
        }
        renderCurrentCard();
    });

    // Fetches the list of restaurants based on the search term
    async function fetchRestaurants(searchTerm) {
        try {
            const query = encodeURIComponent(searchTerm);
            const response = await fetch(`/api/browse?search=${query}`);
            const data = await response.json();
            
            restaurants = data;
            currentIndex = 0; // Reset to the first result
            renderCurrentCard();
        } catch (error) {
            console.error("Failed to load restaurants", error);
            cardContainer.innerHTML = '<div class="empty-state">Error loading data.</div>';
        }
    }

    // Displays the current restaurant's menu items in the carousel card
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
            // Build the HTML list for all menu items
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

        // Insert the header and the menu list into the card
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