const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// 1. Connection Setup
const uri = 'mongodb+srv://mydbuser:dbuser@cluster0.nwqpdop.mongodb.net/?appName=Cluster0';
const client = new MongoClient(uri);

// 2. The Master List of DB Restaurants (from your prompt)
// We use this to check if a "nearby" place is one we actually have data for.
const KNOWN_RESTAURANTS = [
  'Subway', 'Starbucks', "McDonald's", "Dunkin'", 'Burger King',
  'Taco Bell', "Wendy's", 'Chick-fil-A', 'Sonic Drive-In', "Domino's Pizza",
  'KFC', 'Panera Bread', 'Pizza Hut', 'Chipotle', "Arby's",
  'Popeyes', 'Dairy Queen', 'Little Caesars', "Jimmy John's", 'Panda Express',
  'Jack in the Box', "Hardee's", "Papa John's", "Jersey Mike's", 'Firehouse Subs',
  'Five Guys', "Carl's Jr.", 'Whataburger', "Culver's", 'In-N-Out Burger',
  "Zaxby's", 'Wingstop', "Papa Murphy's", 'Checkers', "Raising Cane's",
  'White Castle', 'Del Taco', 'Baskin-Robbins', "Marco's Pizza", 'Qdoba',
  "Moe's Southwest Grill", "Captain D's", "Church's Chicken", "Long John Silver's",
  'Bojangles', 'El Pollo Loco', 'Charleys Philly Steaks', "McAlister's Deli",
  "Jason's Deli", 'Tropical Smoothie Cafe'
];

app.post('/api/rank-restaurants', async (req, res) => {
    try {
        await client.connect();
        const db = client.db("Final_0020");
        const collection = db.collection("restaurant_info");

        // Input: List of names from Google Maps (e.g. ["McDonald's Store 55", "Burger King"])
        const nearbyNames = req.body.restaurants || [];
        
        // Step 1: Filter - Which known chains are actually nearby?
        // We check if the 'known' name appears inside the 'nearby' name string
        const matches = KNOWN_RESTAURANTS.filter(known => 
            nearbyNames.some(nearby => nearby.toLowerCase().includes(known.toLowerCase()))
        );

        if (matches.length === 0) {
            return res.json({ message: "No supported restaurants found nearby.", data: [] });
        }

        // Step 2: Query Mongo for ONLY the matched restaurants
        const cursor = collection.find({ restaurant: { $in: matches } });
        const restaurantDocs = await cursor.toArray();

        // Step 3: Calculate Health Stats
        // We use your "Protein to Calories Ratio" idea. 
        // We find the SINGLE item with the best ratio in the whole restaurant.
        const rankedData = restaurantDocs.map(doc => {
            let bestRatio = -1;
            let bestItemName = "N/A";
            let totalCalories = 0;
            let totalProtein = 0;
            let itemCount = 0;

            if (doc.servings && Array.isArray(doc.servings)) {
                doc.servings.forEach(item => {
                    // Validating data exists
                    const cal = parseFloat(item.calories) || 0;
                    const pro = parseFloat(item.protein) || 0;

                    if (cal > 0) { // Avoid division by zero
                        const ratio = pro / cal;
                        
                        // Check for best item (Highest Ratio)
                        if (ratio > bestRatio) {
                            bestRatio = ratio;
                            bestItemName = item.item_name || item.name; // Adjust based on exact field name
                        }

                        // Accumulate for averages (Your other sorting idea)
                        totalCalories += cal;
                        totalProtein += pro;
                        itemCount++;
                    }
                });
            }

            return {
                name: doc.restaurant,
                // Primary Sort: The "Health Score" (Protein per 1 Calorie)
                healthScore: bestRatio.toFixed(3), 
                bestItem: bestItemName,
                // Secondary Data: Averages
                avgCalories: itemCount > 0 ? (totalCalories / itemCount).toFixed(0) : 0,
                avgProtein: itemCount > 0 ? (totalProtein / itemCount).toFixed(0) : 0
            };
        });

        // Step 4: Sort by Health Score (Highest is better)
        rankedData.sort((a, b) => b.healthScore - a.healthScore);

        res.json({ success: true, data: rankedData });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});