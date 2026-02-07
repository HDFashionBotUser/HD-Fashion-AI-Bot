const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getUserGender(sender_id) {
  try {
    const res = await axios.get(`https://graph.facebook.com/${sender_id}?fields=gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return res.data.gender;
  } catch (error) {
    return 'unknown';
  }
}

async function sendAction(sender_id, action) {
  try {
    await axios.post(`https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      { recipient: { id: sender_id }, sender_action: action }
    );
  } catch (error) {}
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const token = req.query['hub.verify_token'];
    if (token === process.env.VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    return res.status(403).end();
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (body.object === 'page') {
      for (const entry of body.entry) {
        if (entry.messaging) {
          const webhook_event = entry.messaging[0];
          const sender_id = webhook_event.sender.id;

          if (webhook_event.message) {
            let userMsg = webhook_event.message.text || "";
            let imageUrl = null;

            if (webhook_event.message.attachments && webhook_event.message.attachments[0].type === 'image') {
              imageUrl = webhook_event.message.attachments[0].payload.url;
            }

            if (userMsg || imageUrl) {
              await sendAction(sender_id, 'mark_seen');
              await sendAction(sender_id, 'typing_on');

              const gender = await getUserGender(sender_id);
              
              try {
                const aiReply = await getAIReply(userMsg, imageUrl, gender);
                await axios.post(`https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                  { recipient: { id: sender_id }, message: { text: aiReply } }
                );
              } catch (e) { 
                console.error('Final Send Error:', e.message); 
              }
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
  }
};

async function getAIReply(message, imageUrl, gender) {
  try {
    // গুগল শিট থেকে ডাটা আনা
    const sheet = await axios.get(process.env.PRODUCT_DATA_API_URL);
    const products = sheet.data;
    const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : 'স্যার/ম্যাম');

    const content = [];
    if (message) {
      content.push({ type: "text", text: message });
    }

    if (imageUrl) {
      content.push({ 
        type: "text", 
        text: "এই ছবিটি ভালো করে দেখো। ছবির নিচে বা কোথাও কোনো প্রোডাক্ট কোড (যেমন: P001, P002, HF-01) আছে কি না তা শনাক্ত করো এবং সেই অনুযায়ী উত্তর দাও।" 
      });
      content.push({ 
        type: "image_url", 
        image_url: { url: imageUrl, detail: "high" } 
      });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: `আপনি 'HD Fashion' এর একজন সিনিয়র সেলস ম্যানেজার। আপনার কাজ কাস্টমারকে সাহায্য করা।
            ১. সম্বোধন করবেন: ${title}।
            ২. যদি কাস্টমার ছবি পাঠায়, তবে ছবির কোডটি শনাক্ত করে নিচের ডাটাবেস থেকে সঠিক দাম ও তথ্য দিন।
            ৩. ডেলিভারি চার্জ: ঢাকা ৮০, ঢাকার বাইরে ১৫০।
            ৪. ডাটাবেস: ${JSON.stringify(products)}` 
          },
          { role: 'user', content: content }
        ],
        temperature: 0.7,
        max_tokens: 500
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Error Details:', error.response ? JSON.stringify(error.response.data) : error.message);
    return `দুঃখিত, আমি ছবিটি বা মেসেজটি ঠিকমতো প্রসেস করতে পারছি না। আপনি কি কষ্ট করে প্রোডাক্টের কোডটি লিখে দেবেন? আমি এখনই আপনাকে সব তথ্য জানিয়ে দিচ্ছি।`;
  }
}
