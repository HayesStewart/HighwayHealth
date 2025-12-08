// FatSecret Platform API Information
const CONSUMER_KEY = '44ff1fa92d6949158c8f238f573af6af';
const CONSUMER_SECRET = 'bf0c2a168c464e298dcfd76480d1e1e5';

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://mydbuser:dbuser@cluster0.nwqpdop.mongodb.net/?appName=Cluster0';

// Top 50 Fast Food Restaurants in the US by location count
const TOP_50_RESTAURANTS = [
  'Subway', 'Starbucks', 'McDonald\'s', 'Dunkin\'', 'Burger King',
  'Taco Bell', 'Wendy\'s', 'Chick-fil-A', 'Sonic Drive-In', 'Domino\'s Pizza',
  'KFC', 'Panera Bread', 'Pizza Hut', 'Chipotle', 'Arby\'s',
  'Popeyes', 'Dairy Queen', 'Little Caesars', 'Jimmy John\'s', 'Panda Express',
  'Jack in the Box', 'Hardee\'s', 'Papa John\'s', 'Jersey Mike\'s', 'Firehouse Subs',
  'Five Guys', 'Carl\'s Jr.', 'Whataburger', 'Culver\'s', 'In-N-Out Burger',
  'Zaxby\'s', 'Wingstop', 'Papa Murphy\'s', 'Checkers', 'Raising Cane\'s',
  'White Castle', 'Del Taco', 'Baskin-Robbins', 'Marco\'s Pizza', 'Qdoba',
  'Moe\'s Southwest Grill', 'Captain D\'s', 'Church\'s Chicken', 'Long John Silver\'s',
  'Bojangles', 'El Pollo Loco', 'Charleys Philly Steaks', 'McAlister\'s Deli',
  'Jason\'s Deli', 'Tropical Smoothie Cafe'
];

function generateOAuthSignature(method, url, params, consumerSecret) {
  const paramString = Object.keys(params).sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString)
  ].join('&');

  const hmac = crypto.createHmac('sha1', `${encodeURIComponent(consumerSecret)}&`);
  hmac.update(signatureBaseString);
  return hmac.digest('base64');
}

function generateOAuthParams() {
  return {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: '1.0'
  };
}

async function searchFoodsByBrand(brandName, maxResults = 50) {
  try {
    const url = 'https://platform.fatsecret.com/rest/server.api';
    const params = {
      ...generateOAuthParams(),
      method: 'foods.search',
      search_expression: brandName,
      format: 'json',
      max_results: maxResults.toString()
    };

    params.oauth_signature = generateOAuthSignature('GET', url, params, CONSUMER_SECRET);

    const queryString = Object.keys(params).sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    const response = await fetch(`${url}?${queryString}`);
    const data = await response.json();

    if (data.error) {
      console.log(`   API Error: ${data.error.message}`);
      return { branded: [], all: [] };
    }

    if (!data.foods?.food) return { branded: [], all: [] };

    const foods = Array.isArray(data.foods.food) ? data.foods.food : [data.foods.food];
    const brandItems = foods.filter(food => 
      food.brand_name?.toLowerCase().includes(brandName.toLowerCase())
    );

    return { branded: brandItems, all: foods };
  } catch (error) {
    console.error('Error:', error.message);
    return { branded: [], all: [] };
  }
}

async function getFoodNutrition(foodId) {
  try {
    const url = 'https://platform.fatsecret.com/rest/server.api';
    const params = {
      ...generateOAuthParams(),
      method: 'food.get',
      food_id: foodId.toString(),
      format: 'json'
    };

    params.oauth_signature = generateOAuthSignature('GET', url, params, CONSUMER_SECRET);

    const queryString = Object.keys(params).sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    const response = await fetch(`${url}?${queryString}`);
    const data = await response.json();

    return data.error ? null : data.food;
  } catch (error) {
    console.error('Error fetching nutrition:', error.message);
    return null;
  }
}



async function saveToMongoDB(collection, restaurant, foodItem, nutritionData) {
  const servings = Array.isArray(nutritionData.servings.serving) 
    ? nutritionData.servings.serving 
    : [nutritionData.servings.serving];

  await collection.insertOne({
    restaurant,
    food_id: foodItem.food_id,
    food_name: nutritionData.food_name || foodItem.food_name,
    brand_name: nutritionData.brand_name || foodItem.brand_name,
    food_url: nutritionData.food_url,
    servings: servings.map(s => ({
      serving_url: s.serving_url,
      metric_serving_unit: s.metric_serving_unit,
      calories: parseFloat(s.calories),
      protein: parseFloat(s.protein),
      carbohydrate: parseFloat(s.carbohydrate),
      fat: parseFloat(s.fat),
      sodium: parseFloat(s.sodium),
      fiber: parseFloat(s.fiber)
    }))
  });
}

async function importAllRestaurantsToMongoDB() {  
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const collection = client.db('Final_0020').collection('restaurant_info');
    await collection.createIndex({ restaurant: 1 });
    await collection.createIndex({ restaurant: 1, food_id: 1 }, { unique: true });
    await collection.createIndex({ food_name: 'text', brand_name: 'text' });

    let totalSaved = 0;

    for (let i = 0; i < TOP_50_RESTAURANTS.length; i++) {
      const restaurant = TOP_50_RESTAURANTS[i];
      console.log(`\n[${i + 1}/50] ${restaurant}`);

      const { branded, all } = await searchFoodsByBrand(restaurant, 20);
      const items = branded.length > 0 ? branded : all;

      if (!items.length) {
        console.log(`   No items found`);
        continue;
      }

      console.log(`   Found ${items.length} items (${branded.length} branded)`);
      let saved = 0, skipped = 0, failed = 0;

      for (const food of items) {
        if (await collection.findOne({ restaurant, food_id: food.food_id })) {
          skipped++;
          continue;
        }

        const nutrition = await getFoodNutrition(food.food_id);
        if (nutrition) {
          try {
            await saveToMongoDB(collection, restaurant, food, nutrition);
            totalSaved++;
            saved++;
            console.log(`   ✓ ${food.food_name}`);
          } catch (err) {
            if (err.code !== 11000) {
              console.log(`   ✗ ${food.food_name}: ${err.message}`);
              failed++;
            }
          }
        } else {
          failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log(`   ${restaurant}: Saved ${saved}, Skipped ${skipped}, Failed ${failed}`);
      
      // Longer delay between restaurants to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`\nTotal saved: ${totalSaved}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

// Run the import
importAllRestaurantsToMongoDB();