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

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("[DB] Connected.");
  })
  .catch(err => console.error("[DB] Error:", err));

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

let cachedToken = null;
let tokenExpiry = 0;

async function getFatSecretToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken;
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
        cachedToken = response.data.access_token;
        tokenExpiry = now + (response.data.expires_in * 1000);
        return cachedToken;
    } catch (error) {
        console.error("[AUTH ERROR] Token fetch failed:", error.message);
        return null;
    }
}

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

        const data = response.data.foods;
        let cleanItems = [];

        if (data && data.food) {
            let items = Array.isArray(data.food) ? data.food : [data.food];
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
        console.error(`[ERROR] Processing ${restaurantName}:`, error.message);
        return null;
    }
}

app.get('/api/browse', async (req, res) => {
    try {
        const search = req.query.search || "";
        
        let query = {};
        if (search) {
            query.restaurant = { $regex: search, $options: 'i' };
        }

        const items = await Restaurant.find(query).limit(50); 
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/rank-restaurants', async (req, res) => {
  try {
    const rawNames = req.body.restaurantNames;
    const limitPerRestaurant = req.body.limit || 50;
    const uniqueNames = [...new Set(rawNames)];
    
    const rankedResults = await Restaurant.aggregate([
        { $match: { restaurant: { $in: uniqueNames } } },
        { $unwind: "$servings" },
        { $addFields: {
            ratio: { 
                $cond: [ { $gt: ["$servings.calories", 0] }, { $divide: ["$servings.protein", "$servings.calories"] }, 0 ]
            }
        }},
        { $sort: { ratio: -1 } }, 
        { $group: {
            _id: "$restaurant",
            menu: { 
                $push: { 
                    item: "$servings.food_name",
                    cal: "$servings.calories",
                    prot: "$servings.protein",
                    score: "$ratio"
                } 
            },
            highestScore: { $first: "$ratio" }
        }},
        { $project: { menu: { $slice: ["$menu", limitPerRestaurant] }, highestScore: 1 }},
        { $sort: { highestScore: -1 } }
    ]);

    res.json(rankedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/update-single', async (req, res) => {
    const name = req.body.restaurantName;
    try {
        await fetchAndMergeFatSecret(name);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false }); 
    }
});

// --- NEW CLEANUP ROUTE ---
app.delete('/api/cleanup', async (req, res) => {
    try {
        // 1. Remove bad items inside arrays
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

        // 2. Remove restaurants that are now empty
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

app.get('/api/config', (req, res) => res.json({ apiKey: process.env.GOOGLE_MAPS_KEY }));

const PORT = 3000;
app.listen(PORT, () => console.log(`[SYS] Server running at http://localhost:${PORT}`));