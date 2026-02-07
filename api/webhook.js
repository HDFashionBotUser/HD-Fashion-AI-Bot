const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ফেসবুক থেকে ইউজারের জেন্ডার জানার ফাংশন
async function getUserGender(sender_id) {
  try {
    const res = await axios.get(`https://graph.facebook.com/${sender_id}?fields=gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return res.data.gender;
  } catch (error) {
    return 'unknown';
  }
}

// টাইপিং এবং সিন অ্যাকশন
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
              // আপনার শর্ত অনুযায়ী ৭ সেকেন্ডের টাইমিং লজিক
              await sleep(3000); // ৩ সেকেন্ড পর সিন হবে
              await sendAction(sender_id, 'mark_seen');
              
              await sleep(500); 
              await sendAction(sender_id, 'typing_on'); // পরবর্তী ৪ সেকেন্ড টাইপিং দেখাবে

              const gender = await getUserGender(sender_id);
              
              try {
                const aiReply = await getAIReply(userMsg, imageUrl, gender);
                
                // টাইপিং শেষ হওয়ার জন্য অপেক্ষা (মোট ৭ সেকেন্ড পূর্ণ করা)
                await sleep(3500); 

                await axios.post(`https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                  { recipient: { id: sender_id }, message: { text: aiReply } }
                );
              } catch (e) { 
                console.error('Final Error:', e.message); 
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
    const sheet = await axios.get(process.env.PRODUCT_DATA_API_URL);
    const products = sheet.data;
    const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : 'স্যার/ম্যাম');

    const content = [];
    if (message) content.push({ type: "text", text: message });

    if (imageUrl) {
      content.push({ 
        type: "text", 
        text: "এই ছবিটি বিশ্লেষণ করো। ছবিতে থাকা প্রোডাক্ট কোডটি (যেমন: P001, P002) শনাক্ত করো এবং ডাটাবেস থেকে তথ্য দাও।" 
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
            content: `আপনি 'HD Fashion' এর একজন অত্যন্ত মার্জিত ও প্রফেশনাল সিনিয়র সেলস এক্সিকিউটিভ।
            
            আপনার ব্যবহারের নিয়মাবলী:
            ১. ভাষা: একজন আদর্শ শিক্ষকের মতো নম্র, ভদ্র এবং পোলাইট ভাষায় কথা বলবেন। 
            ২. সম্বোধন: কাস্টমারকে সবসময় '${title}' বলে সম্বোধন করবেন। 
            ৩. উত্তর দেওয়ার ধরণ: উত্তর হবে অত্যন্ত সংক্ষিপ্ত কিন্তু ইনফরমেটিভ (টু দ্য পয়েন্ট)। কোনো অপ্রাসঙ্গিক কথা বলবেন না।
            ৪. ইমেজ প্রসেসিং: কাস্টমার ছবি পাঠালে ছবির কোডটি নিচের ডাটাবেসে খুঁজুন। 
            ৫. তথ্য প্রদান: প্রোডাক্টের নাম, সঠিক মূল্য এবং সংক্ষিপ্ত বিবরণ দিন। 
            ৬. ডেলিভারি চার্জ: ঢাকা ৮০ টাকা, ঢাকার বাইরে ১৫০ টাকা।
            ৭. হিউম্যান বিহেভিয়ার: রোবটের মতো নয়, বরং একজন দরদী মানুষের মতো উত্তর দিবেন যেন কাস্টমার সন্তুষ্ট হন।
            
            আপনার বর্তমান প্রোডাক্ট ডাটাবেস: ${JSON.stringify(products)}` 
          },
          { role: 'user', content: content }
        ],
        temperature: 0.5, // উত্তর আরও সঠিক ও স্থির রাখার জন্য
        max_tokens: 300
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    return `জি ${title}, আমি আন্তরিকভাবে দুঃখিত। যান্ত্রিক সমস্যার কারণে ছবিটি দেখতে পাচ্ছি না। আপনি কি দয়া করে প্রোডাক্ট কোডটি লিখে দেবেন? আমি এখনই আপনাকে বিস্তারিত জানিয়ে দিচ্ছি।`;
  }
}
