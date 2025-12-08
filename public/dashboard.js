// dashboard.js

let map;
let service;
let markers = [];
let infoWindow;
let globalUserLoc = null;
let masterGoogleData = []; 
let masterServerData = []; 
let activeBrands = new Set(); 
let currentRadius = 3;
let currentLimit = 10; 
let currentSortMetric = 'health';

let updatesStarted = false;

// --- Helper: Convert Score to Stars ---
function renderStars(ratio) {
    const score = ratio * 10; 
    
    // Mapping Logic:
    // Input Range: -3 to 3 (Total range 6)
    // Output Range: 0 to 5 (Total range 5)
    // Formula: ((score - min) / (max - min)) * maxStars
    let rawStars = ((score - (-3)) / 6) * 5;
    
    // Clamp to 0-5
    if (rawStars < 0) rawStars = 0;
    if (rawStars > 5) rawStars = 5;

    // Round to nearest 0.5
    const stars = Math.round(rawStars * 2) / 2;
    
    // Determine parts
    const fullStars = Math.floor(stars);
    const hasHalf = stars % 1 !== 0;
    const emptyStars = 5 - Math.ceil(stars);

    let html = '';
    
    // Full
    for (let i = 0; i < fullStars; i++) {
        html += '<span class="filled">★</span>';
    }
    
    // Half
    if (hasHalf) {
        html += '<span class="half">★</span>';
    }
    
    // Empty
    for (let i = 0; i < emptyStars; i++) {
        html += '<span class="empty">★</span>';
    }
    
    return `<span class="star-rating">${html}</span>`;
}

function initDashboard() {
    const params = new URLSearchParams(window.location.search);
    currentRadius = parseInt(params.get('radius')) || 3; 
    currentLimit = parseInt(params.get('limit')) || 10; 

    // --- SETUP SLIDERS ---
    const distSlider = document.getElementById('distSlider');
    const limitSlider = document.getElementById('itemLimitSlider');
    const maxCalsSlider = document.getElementById('maxCals');
    const minProtSlider = document.getElementById('minProt');
    
    const distVal = document.getElementById('distVal');
    const limitVal = document.getElementById('limitVal');
    const calVal = document.getElementById('calVal');
    const protVal = document.getElementById('protVal');

    distSlider.value = currentRadius;
    limitSlider.value = currentLimit;
    distVal.innerText = currentRadius;
    limitVal.innerText = currentLimit;
    
    calVal.innerText = maxCalsSlider.value;
    protVal.innerText = minProtSlider.value;

    // --- EVENT LISTENERS ---

    // Sort Buttons
    const sortBtns = document.querySelectorAll('.sort-btn');
    sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sortBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSortMetric = btn.dataset.sort;
            applyFilters();
        });
    });

    // Sliders
    distSlider.addEventListener('input', (e) => {
        distVal.innerText = e.target.value;
    });
    distSlider.addEventListener('change', (e) => {
        console.log("Radius changed to: " + e.target.value);
        currentRadius = parseInt(e.target.value);
        updatesStarted = false; 
        document.getElementById('updateStatus').textContent = ""; 
        performSearch(currentRadius);
    });

    limitSlider.addEventListener('input', (e) => {
        limitVal.innerText = e.target.value;
    });
    limitSlider.addEventListener('change', (e) => {
        console.log("Limit changed to: " + e.target.value);
        currentLimit = parseInt(e.target.value);
        updatesStarted = false;
        document.getElementById('updateStatus').textContent = ""; 
        performSearch(currentRadius);
    });

    maxCalsSlider.addEventListener('input', (e) => {
        calVal.innerText = e.target.value;
        applyFilters(); 
    });

    minProtSlider.addEventListener('input', (e) => {
        protVal.innerText = e.target.value;
        applyFilters(); 
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            globalUserLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            
            map = new google.maps.Map(document.getElementById("map"), {
                center: globalUserLoc, zoom: 13,
                disableDefaultUI: true, zoomControl: true
            });

            new google.maps.Marker({
                position: globalUserLoc, map: map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#4285F4", fillOpacity: 1, strokeColor: "white", strokeWeight: 2 },
                title: "You"
            });

            infoWindow = new google.maps.InfoWindow();
            performSearch(currentRadius);

        }, () => alert("Location permission denied."));
    } else {
        alert("Browser does not support geolocation.");
    }
}

function performSearch(miles) {
    service = new google.maps.places.PlacesService(map);
    const radiusMeters = miles * 1609.34;

    document.getElementById("loading-overlay").style.display = 'flex';

    const requestConfig = {
        location: globalUserLoc,
        rankBy: google.maps.places.RankBy.DISTANCE, 
        type: 'restaurant',
        keyword: 'fast food' 
    };

    service.nearbySearch(requestConfig, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK) {
            document.getElementById("loading-overlay").style.display = 'none';
            document.getElementById("results-list").innerHTML = "<p style='padding:20px'>No results found.</p>";
            document.getElementById('locationCount').innerText = "Found 0 locations";
            document.getElementById('resultCount').innerText = "Found 0 items";
            return;
        }

        const validPlaces = results.map(place => {
            const dist = google.maps.geometry.spherical.computeDistanceBetween(
                place.geometry.location, 
                new google.maps.LatLng(globalUserLoc.lat, globalUserLoc.lng)
            );
            return { ...place, distMeters: dist };
        }).filter(place => place.distMeters <= radiusMeters);

        validPlaces.sort((a, b) => a.distMeters - b.distMeters);

        document.getElementById('locationCount').innerText = `Found ${validPlaces.length} locations`;

        processServerData(validPlaces);
    });
}

function processServerData(results) {
    if (results.length === 0) {
        document.getElementById("loading-overlay").style.display = 'none';
        document.getElementById("results-list").innerHTML = "<p style='padding:20px'>No results found nearby.</p>";
        return;
    }

    masterGoogleData = results.slice(0, 20);
    const names = masterGoogleData.map(p => p.name);

    fetch('/api/rank-restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            restaurantNames: names,
            limit: currentLimit 
        })
    })
    .then(res => res.json())
    .then(data => {
        masterServerData = data;
        activeBrands.clear();
        data.forEach(d => activeBrands.add(d._id));
        
        generateBrandToggles(data);
        applyFilters(); 
        document.getElementById("loading-overlay").style.display = 'none';
        
        if (!updatesStarted) {
            console.log("Starting background updates...");
            updatesStarted = true;
            startBackgroundUpdates(masterGoogleData);
        } else {
            const statusEl = document.getElementById('updateStatus');
            if(statusEl.textContent === "") {
                 statusEl.textContent = "Up to date";
                 statusEl.style.color = "#2E7D32";
            }
        }
    })
    .catch(err => {
        console.error(err);
        document.getElementById("loading-overlay").style.display = 'none';
    });
}

async function startBackgroundUpdates(places) {
    const statusEl = document.getElementById('updateStatus');
    const total = places.length;
    let completed = 0;

    statusEl.textContent = `Updating: 0%`;

    for (const place of places) {
        try {
            await fetch('/api/update-single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ restaurantName: place.name })
            });
        } catch (e) {
            console.error("Update failed for " + place.name);
        }

        completed++;
        const percent = Math.round((completed / total) * 100);
        statusEl.textContent = `Updating: ${percent}%`;
    }

    statusEl.textContent = "Up to date";
    statusEl.style.color = "#2E7D32"; 
    
    console.log("Auto-refreshing the list...");
    processServerData(masterGoogleData);
}

function generateBrandToggles(data) {
    const container = document.getElementById("brand-toggles");
    container.innerHTML = "";
    
    const uniqueBrands = data.map(d => d._id).sort();
    
    uniqueBrands.forEach(brand => {
        const span = document.createElement("span");
        span.className = "brand-tag active"; 
        span.innerText = brand;
        
        span.onclick = () => {
            if (activeBrands.has(brand)) {
                activeBrands.delete(brand);
                span.classList.remove("active");
            } else {
                activeBrands.add(brand);
                span.classList.add("active");
            }
            applyFilters(); 
        };
        container.appendChild(span);
    });
}

function applyFilters() {
    const sortMetric = currentSortMetric;
    const maxCals = parseInt(document.getElementById('maxCals').value);
    const minProt = parseInt(document.getElementById('minProt').value);

    const listContainer = document.getElementById("results-list");
    listContainer.innerHTML = "";
    
    markers.forEach(m => m.setMap(null));
    markers = [];
    const markerItemsMap = new Map();
    let flatList = [];
    
    masterServerData.forEach(r => {
        if (!activeBrands.has(r._id)) return;

        const place = masterGoogleData.find(g => g.name === r._id);
        if (!place) return;

        const marker = new google.maps.Marker({
            position: place.geometry.location, map: null, title: r._id,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#FF5252", fillOpacity: 0.9, strokeColor: "white", strokeWeight: 2 }
        });

        let hasValidItems = false;
        let itemsForMarker = [];

        r.menu.forEach(item => {
            if (item.cal <= maxCals && item.prot >= minProt) {
                const flatItem = { 
                    ...item, 
                    restaurant: r._id, 
                    marker: marker, 
                    lat: place.geometry.location.lat(), 
                    lng: place.geometry.location.lng(),
                    dist: place.distMeters 
                };
                flatList.push(flatItem);
                itemsForMarker.push(flatItem);
                hasValidItems = true;
            }
        });

        if (hasValidItems) {
            marker.setMap(map);
            markers.push(marker);
            markerItemsMap.set(marker, itemsForMarker); // Save the list of filtered items to the map

            // --- INFO WINDOW GENERATION ---
            marker.addListener("click", () => {
                const items = markerItemsMap.get(marker);
                
                // Build the list HTML
                let contentHTML = `
                    <div class="info-window-content">
                        <h4 style="margin-bottom: 5px;">${r._id}</h4>
                        <p style="font-size: 0.9em; margin-top: 0; color: #666;">
                            ${items.length} matching item${items.length === 1 ? '' : 's'}:
                        </p>
                        <ul style="list-style: none; padding: 0; margin: 0;">
                `;

                items.slice(0, 5).forEach(item => { // Show up to 5 items in the window
                    contentHTML += `
                        <li style="font-size: 0.9em; line-height: 1.4;">
                            • ${item.item}: <span style="font-weight: bold; color: #2E7D32;">${item.prot}g P / ${item.cal} C</span>
                        </li>
                    `;
                });

                if (items.length > 5) {
                    contentHTML += `<li style="font-size: 0.8em; color: #999;">...and ${items.length - 5} more.</li>`;
                }

                contentHTML += `</ul></div>`;
                
                infoWindow.setContent(contentHTML);
                infoWindow.open(map, marker);
            });
        }
    });
    flatList.sort((a, b) => {
        if (sortMetric === 'distance') return a.dist - b.dist; 
        if (sortMetric === 'protein') return b.prot - a.prot;
        if (sortMetric === 'calories') return a.cal - b.cal;
        return b.score - a.score; 
    });

    document.getElementById('resultCount').innerText = `Found ${flatList.length} items`;

    if (flatList.length === 0) {
        listContainer.innerHTML = "<p style='padding:20px; text-align:center; color:#888;'>No food matches your filters.</p>";
        return;
    }

    flatList.forEach(item => {
        const el = document.createElement("div");
        el.className = "food-item-row";
        
        const distMiles = (item.dist * 0.000621371).toFixed(1);

        el.innerHTML = `
            <div class="food-info">
                <h4>${item.item}</h4>
                <div class="meta">
                    <span style="background:#e3f2fd; color:#1565c0; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.9em;">
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
        el.onclick = () => {
            const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(item.restaurant + ' ' + item.item)}`;
            
            window.open(googleSearchUrl, '_blank');
            map.setCenter({ lat: item.lat, lng: item.lng });
            map.setZoom(16);
            infoWindow.setContent(`<b>${item.restaurant}</b><br>${item.item}<br>${distMiles} miles away`);
            infoWindow.open(map, item.marker);
        };
        listContainer.appendChild(el);
    });
}