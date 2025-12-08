// --- GLOBAL STATE VARIABLES ---
let map;
let placesService; // This helps me talk to the Google Places API for restaurant locations
let restaurantMarkers = []; // An array to hold all the red dots (markers) on the map
let infoWindow; // The small pop-up box that appears when I click a marker
let myCurrentLocation = null; // Stores my current Latitude and Longitude
let nearbyRestaurantsData = []; // Stores the raw location data from Google Maps API
let serverMenuData = []; // Stores the menu items and health scores I calculated on my server
let currentlyActiveBrands = new Set(); // Tracks which fast food chains are currently checked/active for filtering
let currentSearchRadius = 3; // The distance (in miles) I am searching within, set by the slider
let maxResultsLimit = 10; // The maximum number of menu items to show per restaurant
let currentSortMetric = 'health'; // How the list is currently sorted (e.g., 'health', 'distance')

let backgroundUpdatesRunning = false; // A flag to ensure I only start the menu refresh process once

// --- Convert Health Score to Visual Stars ---
function renderStars(ratio) {
    // This is my custom formula to turn the protein-to-calorie ratio (my 'health score') 
    // into a visible 5-star rating. Higher protein/lower calories means more stars!
    const healthScore = ratio * 10; 
    
    // I defined the min/max range for my score to normalize it to 0-5 stars
    const scoreMin = -3;
    const scoreMax = 3;
    const maxStars = 5;
    
    let rawStars = ((healthScore - scoreMin) / (scoreMax - scoreMin)) * maxStars;
    
    // I keep the final star count between 0 and 5
    if (rawStars < 0) rawStars = 0;
    if (rawStars > 5) rawStars = 5;

    // I round the score to the nearest half-star (e.g., 3.5 stars)
    const stars = Math.round(rawStars * 2) / 2;
    
    // Calculate how many full, half, and empty stars I need to display
    const fullStars = Math.floor(stars);
    const hasHalf = stars % 1 !== 0;
    const emptyStars = 5 - Math.ceil(stars);

    let html = '';
    
    // Build the star icons (filled, half, empty)
    for (let i = 0; i < fullStars; i++) { html += '<span class="filled">★</span>'; }
    if (hasHalf) { html += '<span class="half">★</span>'; }
    for (let i = 0; i < emptyStars; i++) { html += '<span class="empty">★</span>'; }
    
    return `<span class="star-rating">${html}</span>`;
}

function initDashboard() {
    // 1. Initialize settings using the radius and limit chosen on the Home page
    const params = new URLSearchParams(window.location.search);
    currentSearchRadius = parseInt(params.get('radius')) || 3; 
    maxResultsLimit = parseInt(params.get('limit')) || 10; 

    // 2. Set up all my user interface elements (sliders, buttons)
    const distSlider = document.getElementById('distSlider');
    const limitSlider = document.getElementById('itemLimitSlider');
    const maxCalsSlider = document.getElementById('maxCals');
    const minProtSlider = document.getElementById('minProt');
    
    const distVal = document.getElementById('distVal');
    const limitVal = document.getElementById('limitVal');
    const calVal = document.getElementById('calVal');
    const protVal = document.getElementById('protVal');

    // 3. Set the initial text labels for the sliders
    distSlider.value = currentSearchRadius;
    limitSlider.value = maxResultsLimit;
    distVal.innerText = `${currentSearchRadius} mi`;
    limitVal.innerText = maxResultsLimit;
    
    calVal.innerText = `${maxCalsSlider.value} Cal`;
    protVal.innerText = `${minProtSlider.value}g`;

    // 4. Setup Event Listeners for sorting and filtering

    // Sorting buttons: When a user clicks a button, the whole list is immediately re-sorted
    const sortBtns = document.querySelectorAll('.sort-btn');
    sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sortBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSortMetric = btn.dataset.sort;
            filterAndRenderResults(); 
        });
    });

    // Distance slider: Changes the search radius and re-runs the initial Google search
    distSlider.addEventListener('input', (e) => { distVal.innerText = `${e.target.value} mi`; });
    distSlider.addEventListener('change', (e) => {
        currentSearchRadius = parseInt(e.target.value);
        backgroundUpdatesRunning = false; 
        document.getElementById('updateStatus').textContent = ""; 
        initiateGooglePlacesSearch(currentSearchRadius);
    });

    // Results Limit slider: Changes how many menu items are fetched per restaurant
    limitSlider.addEventListener('input', (e) => { limitVal.innerText = e.target.value; });
    limitSlider.addEventListener('change', (e) => {
        maxResultsLimit = parseInt(e.target.value);
        backgroundUpdatesRunning = false;
        document.getElementById('updateStatus').textContent = ""; 
        initiateGooglePlacesSearch(currentSearchRadius);
    });

    // Calorie/Protein sliders: These only re-filter the existing list, making them fast
    maxCalsSlider.addEventListener('input', (e) => {
        calVal.innerText = `${e.target.value} Cal`;
        filterAndRenderResults(); 
    });

    minProtSlider.addEventListener('input', (e) => {
        protVal.innerText = `${e.target.value}g`;
        filterAndRenderResults(); 
    });

    // 5. Ask the browser for my location to start the search
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            myCurrentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            
            // Create the Google Map centered on me
            map = new google.maps.Map(document.getElementById("map"), {
                center: myCurrentLocation, zoom: 13,
                disableDefaultUI: true, zoomControl: true
            });

            // Put a marker on the map to show where I am
            new google.maps.Marker({
                position: myCurrentLocation, map: map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#009688", fillOpacity: 1, strokeColor: "white", strokeWeight: 2 },
                title: "You"
            });

            infoWindow = new google.maps.InfoWindow();
            initiateGooglePlacesSearch(currentSearchRadius);

        }, () => alert("Location permission denied. Cannot find nearby restaurants."));
    } else {
        alert("Your browser does not support geolocation, which is required for this app.");
    }
}

// --- Initiate Google Places API Search ---
function initiateGooglePlacesSearch(miles) {
    // This function finds fast food restaurants near me using Google Maps
    placesService = new google.maps.places.PlacesService(map);
    const radiusMeters = miles * 1609.34; // Convert miles to the meters needed by Google

    document.getElementById("loading-overlay").style.display = 'flex'; 

    // Define what I'm looking for: restaurants, fast food, ranked by distance
    const requestConfig = {
        location: myCurrentLocation,
        rankBy: google.maps.places.RankBy.DISTANCE, 
        type: 'restaurant',
        keyword: 'fast food' 
    };

    placesService.nearbySearch(requestConfig, (results, status) => {
        // Handle search failure
        if (status !== google.maps.places.PlacesServiceStatus.OK) {
            document.getElementById("loading-overlay").style.display = 'none';
            document.getElementById("results-list").innerHTML = "<p style='padding:20px'>Could not find any fast food locations near you.</p>";
            document.getElementById('locationCount').innerText = "Found 0 locations";
            document.getElementById('resultCount').innerText = "Found 0 items";
            return;
        }

        // 1. Calculate the exact distance to each place and filter out any that are outside my selected radius
        const validPlaces = results.map(place => {
            const dist = google.maps.geometry.spherical.computeDistanceBetween(
                place.geometry.location, 
                new google.maps.LatLng(myCurrentLocation.lat, myCurrentLocation.lng)
            );
            return { ...place, distMeters: dist };
        }).filter(place => place.distMeters <= radiusMeters);

        // 2. Sort the list by closest distance again, just to be sure
        validPlaces.sort((a, b) => a.distMeters - b.distMeters);

        document.getElementById('locationCount').innerText = `Found ${validPlaces.length} locations`;

        fetchMenuDataFromServer(validPlaces); // Now ask my server for the menu data
    });
}

// --- Fetch Custom Menu/Score Data ---
function fetchMenuDataFromServer(placesResults) {
    // This takes the list of nearby restaurants and asks my Node.js server to send back menu data and health scores
    if (placesResults.length === 0) {
        document.getElementById("loading-overlay").style.display = 'none';
        document.getElementById("results-list").innerHTML = "<p style='padding:20px'>No results found nearby.</p>";
        return;
    }

    // Prepare the list of names to query my server
    nearbyRestaurantsData = placesResults.slice(0, 20);
    const restaurantNames = nearbyRestaurantsData.map(p => p.name);

    fetch('/api/rank-restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            restaurantNames: restaurantNames,
            limit: maxResultsLimit 
        })
    })
    .then(res => res.json())
    .then(data => {
        serverMenuData = data; // Store the menu data with calculated health scores
        currentlyActiveBrands.clear();
        data.forEach(d => currentlyActiveBrands.add(d._id));
        
        generateBrandToggles(data); // Create the filter buttons at the bottom of the map controls
        filterAndRenderResults(); // Display everything on the map and list
        document.getElementById("loading-overlay").style.display = 'none'; 
        
        // Start the long-running menu update process only on the very first load
        if (!backgroundUpdatesRunning) {
            console.log("Starting background menu updates...");
            backgroundUpdatesRunning = true;
            startBackgroundUpdates(nearbyRestaurantsData);
        } else {
            // Update the status bar after re-fetching the list
            const statusEl = document.getElementById('updateStatus');
            if(statusEl.textContent === "") {
                 statusEl.textContent = "Up to date";
                 statusEl.style.color = "#4CAF50"; 
            }
        }
    })
    .catch(err => {
        console.error("Server menu data fetch failed:", err);
        document.getElementById("loading-overlay").style.display = 'none';
    });
}

// --- Background Menu Update ---
async function startBackgroundUpdates(places) {
    // This starts a slow process where I ask my server to get the absolute latest menu data 
    // for every restaurant in the background, updating my local database slowly.
    const statusEl = document.getElementById('updateStatus');
    const total = places.length;
    let completed = 0;

    statusEl.textContent = `Updating menus: 0%`;

    for (const place of places) {
        try {
            // Ask the server to update one single restaurant's data
            await fetch('/api/update-single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ restaurantName: place.name })
            });
        } catch (e) {
            console.error("Update failed for " + place.name, e);
        }

        completed++;
        const percent = Math.round((completed / total) * 100);
        statusEl.textContent = `Updating menus: ${percent}%`;
    }

    statusEl.textContent = "Up to date";
    statusEl.style.color = "#4CAF50";
    
    // Refresh the dashboard data again to show the user the new menu items that were just found
    console.log("Auto-refreshing the list after updates...");
    fetchMenuDataFromServer(nearbyRestaurantsData);
}

// --- Create Filter Buttons ---
function generateBrandToggles(data) {
    // This creates the list of clickable restaurant names for filtering
    const container = document.getElementById("brand-toggles");
    container.innerHTML = "";
    
    const uniqueBrands = data.map(d => d._id).sort();
    
    uniqueBrands.forEach(brand => {
        const span = document.createElement("span");
        span.className = "brand-tag active"; 
        span.innerText = brand;
        
        // When a brand is clicked, I toggle its active status and re-filter the results
        span.onclick = () => {
            if (currentlyActiveBrands.has(brand)) {
                currentlyActiveBrands.delete(brand);
                span.classList.remove("active");
            } else {
                currentlyActiveBrands.add(brand);
                span.classList.add("active");
            }
            filterAndRenderResults(); 
        };
        container.appendChild(span);
    });
}

// --- Apply Filters and Render UI ---
function filterAndRenderResults() {
    // This is the final step: takes the menu data, applies user filters (macros, brands),
    // and displays the results on the map and in the sidebar list.
    const sortMetric = currentSortMetric;
    const maxCals = parseInt(document.getElementById('maxCals').value);
    const minProt = parseInt(document.getElementById('minProt').value);

    const listContainer = document.getElementById("results-list");
    listContainer.innerHTML = "";
    
    // 1. Clear old map markers and prepare new arrays
    restaurantMarkers.forEach(m => m.setMap(null));
    restaurantMarkers = [];
    const markerItemsMap = new Map();
    let filteredMenuItems = [];

    // 2. Loop through all my menu data from the server
    serverMenuData.forEach(r => {
        if (!currentlyActiveBrands.has(r._id)) return; // Skip if brand is filtered out

        const place = nearbyRestaurantsData.find(g => g.name === r._id);
        if (!place) return;

        // Create a map marker (the red dot)
        const marker = new google.maps.Marker({
            position: place.geometry.location, map: null, title: r._id,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#009688", fillOpacity: 0.9, strokeColor: "white", strokeWeight: 2 } 
        });

        let hasValidItems = false;
        let itemsForMarker = [];

        r.menu.forEach(item => {
            // Check if the item meets the Max Calories and Min Protein filters
            if (item.cal <= maxCals && item.prot >= minProt) {
                const flatItem = { 
                    ...item, 
                    restaurant: r._id, 
                    marker: marker, 
                    lat: place.geometry.location.lat(), 
                    lng: place.geometry.location.lng(),
                    dist: place.distMeters 
                };
                filteredMenuItems.push(flatItem);
                itemsForMarker.push(flatItem);
                hasValidItems = true;
            }
        });

        // 3. If the restaurant has at least one healthy item, show its marker and set up the pop-up window
        if (hasValidItems) {
            marker.setMap(map);
            restaurantMarkers.push(marker);
            markerItemsMap.set(marker, itemsForMarker); 

            // Marker click listener: Displays a list of the healthy items in the pop-up window
            marker.addListener("click", () => {
                const items = markerItemsMap.get(marker);
                
                let contentHTML = `
                    <div class="info-window-content">
                        <h4 style="margin-bottom: 5px; color:#4CAF50;">${r._id}</h4>
                        <p style="font-size: 0.9em; margin-top: 0; color: #666;">
                            ${items.length} healthy item${items.length === 1 ? '' : 's'}:
                        </p>
                        
                        <div style="max-height: 200px; overflow-y: auto; padding-right: 10px;">
                            <ul style="list-style: none; padding: 0; margin: 0;">
                `;

                items.forEach(item => { 
                    contentHTML += `
                        <li style="font-size: 0.9em; line-height: 1.4;">
                            • ${item.item}: <span style="font-weight: bold; color: #009688;">${item.prot}g P / ${item.cal} C</span>
                        </li>
                    `;
                });

                contentHTML += `</ul></div></div>`;
                
                infoWindow.setContent(contentHTML);
                infoWindow.open(map, marker);
            });
        }
    });
    
    // 4. Sort the final list based on which button the user clicked
    filteredMenuItems.sort((a, b) => {
        if (sortMetric === 'distance') return a.dist - b.dist; 
        if (sortMetric === 'protein') return b.prot - a.prot; 
        if (sortMetric === 'calories') return a.cal - b.cal; 
        if (sortMetric === 'health') return b.score - a.score; 
        return b.score - a.score; 
    });

    document.getElementById('resultCount').innerText = `Found ${filteredMenuItems.length} items`;

    // 5. Handle the empty state if no items are found
    if (filteredMenuItems.length === 0) {
        listContainer.innerHTML = "<p style='padding:20px; text-align:center; color:#888;'>No food matches your current filters.</p>";
        return;
    }

    // 6. Build and append the final list items to the sidebar
    filteredMenuItems.forEach(item => {
        const el = document.createElement("div");
        el.className = "food-item-row";
        
        const distMiles = (item.dist * 0.000621371).toFixed(1);

        el.innerHTML = `
            <div class="food-info">
                <h4>${item.item}</h4>
                <div class="meta">
                    <span style="background:#e8f5e9; color:#009688; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.9em;">
                        ${distMiles} mi
                    </span> 
                    &nbsp; ${item.restaurant}
                </div>
            </div>
            <div class="food-stats">
                <div style="text-align:right;">
                    ${renderStars(item.score)}
                </div>
                <span class="macros">${item.prot}g P / ${item.cal} C</span>
            </div>
        `;
        
        // Click listener: Opens Google search in a new tab & focuses map
        el.onclick = () => {
            // Creates the search query: "Burger King Whopper nutrition"
            const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(item.restaurant + ' ' + item.item + ' nutrition')}`;
            
            window.open(googleSearchUrl, '_blank'); // Opens the search in a new window
            map.setCenter({ lat: item.lat, lng: item.lng });
            map.setZoom(16);
            infoWindow.setContent(`<b>${item.restaurant}</b><br>${item.item}<br>${distMiles} miles away`);
            infoWindow.open(map, item.marker);
        };
        listContainer.appendChild(el);
    });
}