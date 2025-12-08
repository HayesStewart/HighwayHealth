require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 1. Connect to my MongoDB database
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("[DB] Connected to my database successfully.");
  })
  .catch(err => console.error("[DB] Error connecting:", err));

// 2. Define the structure (Schema) for my restaurant data in the database
const restaurantSchema = new mongoose.Schema({
  restaurant: String, 
  lastUpdated: { type: Date, default: Date.now },
  servings: [{
    food_name: String,
    calories: Number,
    protein: Number,
    carbohydrate: Number
  }]
}, { collection: 'restaurant_info' });

const Restaurant = mongoose.model('Restaurant', restaurantSchema);

// --- fatsecret authentification ---

let cachedToken = null;
let tokenExpiry = 0;

// Function to get a secure temporary access key (Token) for the FatSecret API
async function getFatSecretToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken; // Use cached key if it hasn't expired
    try {
        const response = await axios.post('https://oauth.fatsecret.com/connect/token', 
            qs.stringify({ grant_type: 'client_credentials', scope: 'basic' }), 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(process.env.FATSECRET_CLIENT_ID + ':' + process.env.FATSECRET_CLIENT_SECRET).toString('base64')
                }
            }
        );
        // Store the new key and its expiration time
        cachedToken = response.data.access_token;
        tokenExpiry = now + (response.data.expires_in * 1000);
        return cachedToken;
    } catch (error) {
        console.error("[AUTH ERROR] Failed to get FatSecret access key:", error.message);
        return null;
    }
}

// Function to pull out the calories, protein, and carbs from the API's description text
function parseNutrients(description) {
    if (!description) return { calories: 0, protein: 0, carbs: 0 };
    const getVal = (regex) => {
        const match = description.match(regex);
        return match ? parseFloat(match[1]) : 0;
    };
    return {
        calories: getVal(/Calories:\s*(\d+)/i),
        protein: getVal(/Protein:\s*([\d\.]+)/i),
        carbs: getVal(/Carbs:\s*([\d\.]+)/i)
    };
}

// Function to call FatSecret, pull menu data for a specific restaurant, and save/merge it into my database
async function fetchAndMergeFatSecret(restaurantName) {
    try {
        let doc = await Restaurant.findOne({ restaurant: restaurantName });
        const token = await getFatSecretToken();
        if (!token) return null;

        const response = await axios.get('https://platform.fatsecret.com/rest/foods/search/v1', {
            headers: { Authorization: `Bearer ${token}` },
            params: { 
                search_expression: restaurantName, 
                format: 'json', 
                max_results: 50, 
                page_number: 0 
            }
        });

        // Process the raw data from the API
        const data = response.data.foods;
        let cleanItems = [];

        if (data && data.food) {
            let items = Array.isArray(data.food) ? data.food : [data.food];
            // Filter out items that don't have calorie counts and parse their nutrition info
            cleanItems = items
                .filter(item => item.food_description && /calories:\s*\d+/i.test(item.food_description))
                .map(item => {
                    const macros = parseNutrients(item.food_description);
                    return {
                        food_name: item.food_name,
                        calories: macros.calories,
                        protein: macros.protein,
                        carbohydrate: macros.carbs
                    };
                });
        }

        if (cleanItems.length === 0) return doc; 

        // Save new menu items to my database, only adding items that don't already exist
        if (!doc) {
            doc = new Restaurant({ restaurant: restaurantName, servings: cleanItems });
        } else {
            cleanItems.forEach(newItem => {
                const exists = doc.servings.some(s => s.food_name === newItem.food_name);
                if (!exists) {
                    doc.servings.push(newItem);
                }
            });
        }

        await doc.save();
        return doc;

    } catch (error) {
        console.error(`[ERROR] Processing menu data for ${restaurantName}:`, error.message);
        return null;
    }
}

// --- API ROUTES ---

// Route 1: /api/browse (Used by the Home Page carousel to view raw database contents)
app.get('/api/browse', async (req, res) => {
    try {
        const search = req.query.search || "";
        
        let query = {};
        if (search) {
            // Allows searching for restaurants by name (case-insensitive)
            query.restaurant = { $regex: search, $options: 'i' };
        }

        const items = await Restaurant.find(query).limit(50); 
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Route 2: /api/rank-restaurants (The main dashboard data provider)
app.post('/api/rank-restaurants', async (req, res) => {
  try {
    const rawNames = req.body.restaurantNames;
    const limitPerRestaurant = req.body.limit || 50;
    const uniqueNames = [...new Set(rawNames)];
    
    // This route does the heavy lifting: it calculates the Protein/Calorie ratio for every menu item,
    // groups the menu items by restaurant, keeps only the healthiest items, and sends back a ranked list.
    const rankedResults = await Restaurant.aggregate([
        { $match: { restaurant: { $in: uniqueNames } } }, // 1. Only look at the restaurants requested
        { $unwind: "$servings" }, // 2. Separate every menu item into its own row temporarily
        { $addFields: {
            ratio: { // 3. Calculate my custom health score: Protein / Calories
                $cond: [ { $gt: ["$servings.calories", 0] }, { $divide: ["$servings.protein", "$servings.calories"] }, 0 ]
            }
        }},
        { $sort: { ratio: -1 } }, // 4. Sort all menu items by my health score (best items first)
        { $group: {
            _id: "$restaurant",
            menu: { // 5. Put the top-ranked menu items back into a menu array for that restaurant
                $push: { 
                    item: "$servings.food_name",
                    cal: "$servings.calories",
                    prot: "$servings.protein",
                    score: "$ratio"
                } 
            },
            highestScore: { $first: "$ratio" } // Track the absolute best score for the restaurant
        }},
        { $project: { menu: { $slice: ["$menu", limitPerRestaurant] }, highestScore: 1 }}, // 6. Only keep the top 'X' menu items
        { $sort: { highestScore: -1 } } // 7. Final sort: Rank the restaurants themselves by their best item
    ]);

    res.json(rankedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error during ranking' });
  }
});

// Route 3: /api/update-single (Used by the dashboard to update one restaurant in the background)
app.post('/api/update-single', async (req, res) => {
    const name = req.body.restaurantName;
    try {
        await fetchAndMergeFatSecret(name); // Runs the fetch/merge logic
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false }); 
    }
});

// Route 4: /api/cleanup (Used by the Home Page to keep the database tidy)
app.delete('/api/cleanup', async (req, res) => {
    try {
        // 1. Remove menu items that somehow ended up blank or incomplete
        const pullResult = await Restaurant.updateMany({}, {
            $pull: { 
                servings: { 
                    $or: [
                        { food_name: { $exists: false } }, 
                        { food_name: null }, 
                        { food_name: "undefined" },
                        { food_name: "" }
                    ]
                } 
            }
        });

        // 2. Delete any entire restaurants that no longer have any menu items after step 1
        const deleteResult = await Restaurant.deleteMany({
            $or: [
                { servings: { $exists: false } }, 
                { servings: { $size: 0 } }
            ]
        });

        res.json({ 
            success: true, 
            itemsRemoved: pullResult.modifiedCount, 
            restaurantsRemoved: deleteResult.deletedCount 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Route 5: /api/config (Sends the Google Maps API Key to the client securely)
app.get('/api/config', (req, res) => res.json({ apiKey: process.env.GOOGLE_MAPS_KEY }));

const PORT = process.env.PORT || 3000; // Use Heroku's assigned port, or 3000 locally
app.listen(PORT, () => console.log(`[SYS] Server running on port ${PORT}`));