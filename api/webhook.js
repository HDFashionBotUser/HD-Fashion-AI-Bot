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

          // টেক্সট অথবা ইমেজ মেসেজ চেক করা
          if (webhook_event.message) {
            let userMsg = webhook_event.message.text || "";
            let imageUrl = null;

            // যদি কাস্টমার ছবি পাঠায়
            if (webhook_event.message.attachments && webhook_event.message.attachments[0].type === 'image') {
              imageUrl = webhook_event.message.attachments[0].payload.url;
            }

            if (userMsg || imageUrl) {
              await sleep(3000); 
              await sendAction(sender_id, 'mark_seen');
              await sleep(500); 
              await sendAction(sender_id, 'typing_on');

              const gender = await getUserGender(sender_id);
              const aiReplyPromise = getAIReply(userMsg, imageUrl, gender);
              
              await sleep(5000); 

              try {
                const aiReply = await aiReplyPromise;
                await axios.post(`https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                  { recipient: { id: sender_id }, message: { text: aiReply } }
                );
              } catch (e) { console.error('Send Error:', e.message); }
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
  }
};

async function getAIReply(message, imageUrl, gender) {
  const sheet = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheet.data;
  const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : 'স্যার/ম্যাম');

  // মেসেজ কন্টেন্ট তৈরি (টেক্সট এবং ইমেজ সাপোর্ট)
  const content = [];
  if (message) content.push({ type: "text", text: message });
  if (imageUrl) {
    content.push({ type: "text", text: "এই ছবিটি বিশ্লেষণ করো এবং ছবির ভেতরে থাকা প্রোডাক্ট কোডটি খুঁজে বের করে গুগল শিট থেকে তথ্য দাও।" });
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত দক্ষ সিনিয়র সেলস ম্যানেজার। আপনার লক্ষ্য সেল নিশ্চিত করা।
          
          আপনার নির্দেশিকা:
          ১. সম্বোধন: ${title}।
          ২. ইমেজ প্রসেসিং: যদি কাস্টমার কোনো ছবি পাঠায়, তবে ছবির ভেতরে থাকা কোডটি (যেমন: P002, HF-01 ইত্যাদি) শনাক্ত করুন।
          ৩. প্রোডাক্ট ম্যাচিং: শনাক্ত করা কোডটি নিচের ডাটাবেসে খুঁজুন এবং সেই প্রোডাক্টের নাম, মূল্য, এবং ডেসক্রিপশন কাস্টমারকে জানান।
          ৪. যদি কোড না পান: অত্যন্ত বিনয়ের সাথে বলুন যে কোডটি পরিষ্কার দেখা যাচ্ছে না।
          ৫. ডেলিভারি চার্জ: ঢাকা ৮০, ঢাকার বাইরে ১৫০।
          ৬. ডাটাবেস: ${JSON.stringify(products)}` 
        },
        { role: 'user', content: content }
      ],
      temperature: 0.7
    },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}
