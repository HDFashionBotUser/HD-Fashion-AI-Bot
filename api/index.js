// This file includes RAG (Google Sheet Search) and handling for Messenger Messages, Comments, and WhatsApp.
import { OpenAI } from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- RAG Functions: Search Product Data from Google Sheet API ---
async function searchProductData(query) {
    const apiUrl = process.env.PRODUCT_DATA_API_URL;
    if (!apiUrl) return "No product data API URL found.";

    try {
        // Step 1: Use OpenAI to extract key search terms (design, price, etc.)
        const extraction = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [
                {
                    role: "system",
                    content: "Extract the single most important product name, ID, or keyword (like 'pink' or 'price') from the user's query that is relevant to women's clothing. Respond with only the keyword itself, nothing else. If no specific keyword is found, return 'ALL'."
                },
                {
                    role: "user",
                    content: query
                }
            ],
            temperature: 0,
            max_tokens: 10,
        });

        const keyword = extraction.choices[0].message.content.trim().toUpperCase();
        console.log(`Extracted Keyword: ${keyword}`);

        // Step 2: Fetch all product data from the Google Sheet API
        const response = await fetch(apiUrl);
        const data = await response.json();
        const products = data.sheet1 || []; 

        // Step 3: Filter products based on the extracted keyword
        let relevantProducts = products;
        
        if (keyword !== 'ALL') {
            relevantProducts = products.filter(product => 
                Object.values(product).some(val => 
                    String(val).toUpperCase().includes(keyword)
                )
            );
        }

        // Step 4: Convert relevant product data to a readable string for the AI
        if (relevantProducts.length === 0) {
            return "No relevant product found in the database. Mention that the specific item is currently unavailable and suggest checking other items.";
        }
        
        // Limit context to the top 3 results
        const contextString = relevantProducts.slice(0, 3).map(product => 
            `ডিজাইনের নাম: ${product.Design_Name}, দাম: ${product.Price}, মেটেরিয়াল: ${product.Material}, সাইজ: ${product.Available_Size}, বিস্তারিত: ${product.Description}`
        ).join(" | ");

        return `প্রাসঙ্গিক প্রোডাক্ট ডেটা (গুগল শিট থেকে): ${contextString}`;

    } catch (error) {
        console.error("Error fetching or processing product data:", error);
        return "Internal error: Could not access product database.";
    }
}

// --- Facebook/WhatsApp API Functions ---
const callSendAPI = async (sender_id, response, type, token) => {
    const url = `https://graph.facebook.com/v19.0/me/${type}?access_token=${token}`;
    
    // Structure payload for Messenger/WhatsApp (messages) or Comments (feed)
    const payload = type === 'messages' ? 
        { recipient: { id: sender_id }, message: { text: response } } :
        { message: response, object_id: sender_id };

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
};

// --- Main Handler for All Events ---
const handleWebhookEvent = async (event) => {
    let sender_id, user_message, response_type, token;

    // --- Determine Channel and Tokens ---
    if (event.message) { 
        // Handles Messenger messages
        sender_id = event.sender.id;
        user_message = event.message.text;
        response_type = 'messages';
        token = process.env.PAGE_ACCESS_TOKEN;
    } else if (event.post_id && event.comment_id) { 
        // Handles Facebook Comments
        sender_id = event.comment_id;
        user_message = event.message;
        response_type = 'comments';
        token = process.env.PAGE_ACCESS_TOKEN;
    } else if (event.entry[0]?.changes[0]?.field === 'whatsapp_business_account') { 
        // Handles WhatsApp messages (requires dedicated WhatsApp token logic, simplified here)
        // Note: For advanced WhatsApp, you might need a dedicated function.
        // For simplicity, we assume the same access token can be used if WhatsApp is under the same Meta App.
        // However, a dedicated token is best practice.
        return; // Temporarily skipping complex WhatsApp handling to focus on core logic
    } else {
        return; // Ignore other events
    }

    try {
        // 1. RAG Step: Get product context
        const product_context = await searchProductData(user_message);

        // 2. Final AI Call (with RAG context)
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Efficient and intelligent model
            messages: [
                {
                    role: "system",
                    content: `আপনি 'HD Fashion'-এর জন্য একজন অত্যন্ত মার্জিত, বন্ধুত্বপূর্ণ এবং মানবিক (হিউম্যান বিহেভ) সহকারী। আপনি মহিলাদের পোশাক (থ্রি পিস, শাড়ি, গাউন) নিয়ে কাজ করেন। সর্বদা 'জি', 'অবশ্যই', 'নিশ্চয়ই' -এর মতো শব্দ ব্যবহার করে বাংলাতে উত্তর দিন। আপনার উত্তর যেন প্রফেশনাল এবং উৎসাহব্যঞ্জক হয়। দেওয়া প্রোডাক্ট ডেটার উপর ভিত্তি করে উত্তর দিন। যদি কোনো নির্দিষ্ট তথ্য না পাওয়া যায়, তাহলে বিনয়ের সাথে বলুন যে ওই আইটেমটি এই মুহূর্তে উপলব্ধ নেই। প্রোডাক্ট ডেটা: ${product_context}`
                },
                {
                    role: "user",
                    content: user_message
                }
            ],
            temperature: 0.5,
            max_tokens: 250,
        });

        const aiResponse = completion.choices[0].message.content;

        // 3. Send final response (Message or Comment)
        await callSendAPI(sender_id, aiResponse, response_type, token);

    } catch (error) {
        console.error("Main Handler Error:", error);
        const fallbackMessage = "দুঃখিত, বর্তমানে AI উত্তর দিতে পারছে না। শীঘ্রই একজন মানব প্রতিনিধি উত্তর দেবেন।";
        await callSendAPI(sender_id, fallbackMessage, response_type, token);
    }
};


// --- Vercel Serverless Function (Main Export) ---
export default async (req, res) => {
    // Part 1: Facebook Webhook Verification (GET)
    if (req.method === 'GET') {
        const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        } else {
            return res.status(403).send('Verification token mismatch.');
        }
    }

    // Part 2: Handling Incoming Events (POST)
    if (req.method === 'POST') {
        const body = req.body;

        if (body.object === 'page' && body.entry) {
            body.entry.forEach(function(entry) {
                // Check for Messaging Event (Messenger)
                if (entry.messaging && entry.messaging.length > 0) {
                    handleWebhookEvent(entry.messaging[0]);
                }
                // Check for Feed Event (Comments)
                if (entry.changes && entry.changes.length > 0) {
                    entry.changes.forEach(change => {
                        if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                            const commentEvent = {
                                post_id: change.value.post_id,
                                comment_id: change.value.comment_id,
                                message: change.value.message,
                                sender: { id: change.value.sender_id }
                            };
                            handleWebhookEvent(commentEvent);
                        }
                    });
                }
            });
            return res.status(200).send('EVENT_RECEIVED');
        }
        return res.status(404).send('Not a page event.');
    }
    
    res.status(405).send('Method Not Allowed.');
};
