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

// --- CONNECT TO MONGODB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("[DB] MongoDB Connected");
    try {
        const col = mongoose.connection.collection('restaurant_info');
        await col.dropIndex('food_id_1'); 
        await col.dropIndex('restaurant_1_food_id_1'); 
    } catch (e) { }
  })
  .catch(err => console.error("[DB] MongoDB Error:", err));

// --- CLEAN SCHEMA ---
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

// --- FATSECRET AUTH HELPER ---
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
        console.error("[AUTH ERROR]", error.message);
        if (error.response) console.error("Details:", error.response.data);
        return null;
    }
}

// --- PARSE NUTRIENTS STRING ---
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

// --- MAIN SEARCH LOGIC (ROBUST) ---
async function fetchAndMergeFatSecret(restaurantName) {
    try {
        const token = await getFatSecretToken();
        if (!token) return null;

        let candidates = [restaurantName];
        const words = restaurantName.split(' ');

        if (words.length > 1) {
            for (let i = words.length - 1; i >= 1; i--) {
                const subString = words.slice(0, i).join(' ');
                // Guard: Prevent reducing to single word
                if (i === 1 && words.length > 1) continue; 
                candidates.push(subString);
            }
        }
        
        if (restaurantName.includes("'")) {
            candidates.push(restaurantName.replace("'", ""));
        }
        candidates = [...new Set(candidates)];

        console.log(`[SEARCH] Processing: ${restaurantName}`);
        let foundItems = null;

        for (const term of candidates) {
            if (term.length < 3) continue;

            try {
                const response = await axios.get('https://platform.fatsecret.com/rest/foods/search/v1', {
                    headers: { Authorization: `Bearer ${token}` },
                    params: {
                        search_expression: term,
                        format: 'json',
                        max_results: 50,
                        page_number: 0
                    }
                });

                // --- CRASH PREVENTION CHECK ---
                if (response.data.error) {
                    console.error(`[API ERROR] FatSecret Error for "${term}": ${response.data.error.message}`);
                    continue; // Skip this candidate if API rejects it
                }

                const data = response.data.foods;
                if (data && data.food) {
                    let items = Array.isArray(data.food) ? data.food : [data.food];
                    
                    const hasCalories = items.some(i => 
                        i.food_description && /calories:/i.test(i.food_description)
                    );

                    if (hasCalories) {
                        console.log(`   [MATCH] Found using: "${term}"`);
                        foundItems = items;
                        break; 
                    }
                }
            } catch (err) { 
                console.error(`[REQ ERROR] Failed request for "${term}":`, err.message);
            }
        }

        if (!foundItems) {
            console.log(`   [INFO] No valid results found for ${restaurantName}.`);
            return null;
        }

        const cleanItems = foundItems
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

        let doc = await Restaurant.findOne({ restaurant: restaurantName });
        if (!doc) {
            doc = new Restaurant({ restaurant: restaurantName, servings: cleanItems });
            await doc.save();
            console.log(`   [DB] Saved ${cleanItems.length} items.`);
        } else {
            let added = 0;
            cleanItems.forEach(newItem => {
                if (!doc.servings.some(s => s.food_name === newItem.food_name)) {
                    doc.servings.push(newItem);
                    added++;
                }
            });
            await doc.save();
            console.log(`   [DB] Updated with ${added} new items.`);
        }
        return doc;

    } catch (error) {
        console.error(`[ERROR] Processing ${restaurantName}:`, error.message);
        return null;
    }
}

// --- API ROUTES ---

app.post('/api/rank-restaurants', async (req, res) => {
  try {
    const rawNames = req.body.restaurantNames;
    const uniqueNames = [...new Set(rawNames)];

    // Fetch in chunks
    const chunkSize = 5;
    for (let i = 0; i < uniqueNames.length; i += chunkSize) {
        const chunk = uniqueNames.slice(i, i + chunkSize);
        await Promise.all(chunk.map(name => fetchAndMergeFatSecret(name)));
    }

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
        { $project: { menu: { $slice: ["$menu", 50] }, highestScore: 1 }},
        { $sort: { highestScore: -1 } }
    ]);

    res.json(rankedResults);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/config', (req, res) => res.json({ apiKey: process.env.GOOGLE_MAPS_KEY }));

const PORT = 3000;
app.listen(PORT, () => console.log(`[SYS] Server running at http://localhost:${PORT}`));