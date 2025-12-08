// public/script.js

let map;
let service;
let markers = [];

function initMap() {
    // 1. Get User Location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const userLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            };

            // 2. Render Map
            map = new google.maps.Map(document.getElementById("map"), {
                center: userLocation,
                zoom: 14,
                styles: [ /* Optional: Add cool map styles here */ ]
            });

            // User's Location Marker (Blue Dot)
            new google.maps.Marker({
                position: userLocation,
                map: map,
                title: "You are here",
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 7,
                    fillColor: "#4285F4",
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: "white",
                }
            });

            // 3. Search for Fast Food
            service = new google.maps.places.PlacesService(map);
            service.nearbySearch(
                {
                    location: userLocation,
                    radius: 5000, 
                    keyword: "fast food",
                    type: "restaurant"
                },
                handleNearbyResults
            );

        }, () => {
            console.error("Geolocation failed.");
        });
    } else {
        console.error("Browser doesn't support geolocation.");
    }
}

function handleNearbyResults(results, status) {
    if (status !== google.maps.places.PlacesServiceStatus.OK) return;

    const fastFood20 = results.slice(0, 20);
    const namesOnly = fastFood20.map(place => place.name);

    // SHOW LOADER
    document.getElementById("loading-overlay").style.display = "flex";

    fetch('/api/rank-restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantNames: namesOnly })
    })
    .then(response => response.json())
    .then(rankedData => {
        displayResults(rankedData);
        addMapMarkers(fastFood20, rankedData);
        
        // HIDE LOADER
        document.getElementById("loading-overlay").style.display = "none";
    })
    .catch(err => {
        console.error(err);
        // HIDE LOADER on error too
        document.getElementById("loading-overlay").style.display = "none";
    });
}

function addMapMarkers(googlePlaces, healthData) {
    // Clear old markers
    markers.forEach(m => m.setMap(null));
    markers = [];

    const infoWindow = new google.maps.InfoWindow();

    googlePlaces.forEach(place => {
        // CHECK: Do we have health data for this place?
        const healthInfo = healthData.find(h => h._id === place.name);

        // FILTER: If no health data, DO NOT add a marker (as per your request)
        if (!healthInfo) return;

        const marker = new google.maps.Marker({
            map: map,
            position: place.geometry.location,
            title: place.name,
            animation: google.maps.Animation.DROP
        });

        // Content for the popup
        const bestItem = healthInfo.menu[0]; // Top item
        const contentString = `
            <div style="padding:5px;">
                <h3 style="margin:0;">${place.name}</h3>
                <p style="margin:5px 0;">${place.vicinity}</p>
                <hr>
                <p style="color:#2E7D32; font-weight:bold;">Top Pick: ${bestItem.item}</p>
                <p>${bestItem.cal} Cal | ${bestItem.prot}g Protein</p>
            </div>`;

        marker.addListener("click", () => {
            infoWindow.setContent(contentString);
            infoWindow.open(map, marker);
        });

        markers.push(marker);
    });
}

function displayResults(rankedData) {
    const container = document.getElementById("results-list");
    container.innerHTML = ""; 

    if (rankedData.length === 0) {
        container.innerHTML = "<p>No matching healthy options found.</p>";
        return;
    }

    rankedData.forEach(restaurant => {
        const card = document.createElement("div");
        card.className = "card";

        let htmlContent = `<h3>${restaurant._id}</h3>`;
        
        // Mini-table for top 3 items
        htmlContent += `<table style="width:100%; font-size: 0.9em; border-collapse: collapse; margin-top: 5px;">
                        <tr style="border-bottom: 1px solid #ddd; text-align: left; color: #555;">
                            <th>Item</th>
                            <th>Cal</th>
                            <th>Prot</th>
                        </tr>`;
        
        restaurant.menu.forEach(food => {
            htmlContent += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 4px 0;">${food.item}</td>
                    <td>${food.cal}</td>
                    <td>${food.prot}g</td>
                </tr>
            `;
        });
        
        htmlContent += `</table>`;
        card.innerHTML = htmlContent;
        container.appendChild(card);
    });
}