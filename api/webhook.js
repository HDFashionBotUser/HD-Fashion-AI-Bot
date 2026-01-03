const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// মেটা থেকে প্রোফাইল তথ্য সংগ্রহ
async function getUserProfile(sender_psid) {
  try {
    const response = await axios.get(`https://graph.facebook.com/${sender_psid}?fields=first_name,gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return response.data;
  } catch (error) {
    console.error('Profile Error:', error.message);
    return { first_name: 'সম্মানিত কাস্টমার', gender: 'unknown' };
  }
}

// টাইপিং এবং সিন অ্যাকশন পাঠানো
async function sendAction(sender_psid, action) {
  try {
    await axios.post(
      `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      { recipient: { id: sender_psid }, sender_action: action }
    );
  } catch (error) {
    console.error(`Action ${action} Error:`, error.message);
  }
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

          if (webhook_event.message && webhook_event.message.text) {
            const userMsg = webhook_event.message.text;

            // ১. ৩ সেকেন্ড পর সিন হবে
            await sleep(3000); 
            await sendAction(sender_id, 'mark_seen');

            // ২. টাইপিং শুরু এবং ৫ সেকেন্ড ধরে রাখা
            await sendAction(sender_id, 'typing_on');

            // ৩. ব্যাকগ্রাউন্ডে AI উত্তর তৈরি করা
            const profile = await getUserProfile(sender_id);
            const aiReplyPromise = getAIReply(userMsg, profile.first_name, profile.gender);

            // ৪. টাইপিং এনিমেশন নিশ্চিত করতে ৫ সেকেন্ড অপেক্ষা
            await sleep(5000); 

            try {
              const aiReply = await aiReplyPromise;
              await axios.post(
                `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                {
                  recipient: { id: sender_id },
                  message: { text: aiReply }
                }
              );
            } catch (e) {
              console.error('Send Error:', e.message);
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
  }
};

async function getAIReply(message, name, gender) {
  const sheet = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheet.data;
  const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : '');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর সিনিয়র সেলস ম্যানেজার। আপনার লক্ষ্য কাস্টমারকে সন্তুষ্ট রাখা এবং সেল ক্লোজ করা।
          - **সম্বোধন:** শুধু প্রথম রিপ্লাইয়ে "জি ${name} ${title}" বলবেন। 
          - **অগ্রাধিকার:** কাস্টমার যদি নতুন কালেকশন দেখতে চায়, তবে আগের অভিযোগ নিয়ে বেশি সময় নষ্ট করবেন না। সংক্ষেপে সমবেদনা জানিয়ে সরাসরি প্রোডাক্টের বিবরণ দিন। 
          - **তথ্য প্রদান:** প্রোডাক্ট সাইজ (m, l, xl) গুলোকে "মিডিয়াম, লার্জ, এক্সট্রা লার্জ" হিসেবে লিখুন। 
          - **স্বাভাবিকতা:** বারবার ধন্যবাদ বা রোবটিক প্রশ্ন করবেন না। কাস্টমার যেটির উত্তর চেয়েছে সেটি আগে দিন।
          - **প্রোডাক্ট লিস্ট:** ${JSON.stringify(products)}। কাস্টমারকে ডিজাইনগুলোর বিশেষত্ব (যেমন কাপড় বা ফিনিশিং) বুঝিয়ে বলুন যাতে সে কিনতে আগ্রহী হয়।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.7
    },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}
