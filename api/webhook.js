const axios = require('axios');

// নির্দিষ্ট সময় অপেক্ষা করার ফাংশন
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// মেটা থেকে কাস্টমারের প্রোফাইল পাওয়ার ফাংশন
async function getUserProfile(sender_id) {
  try {
    const res = await axios.get(`https://graph.facebook.com/${sender_id}?fields=first_name,gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return res.data;
  } catch (error) {
    console.error('Profile Fetch Error:', error.message);
    return { first_name: 'সম্মানিত কাস্টমার', gender: 'unknown' };
  }
}

// মেটা এপিআই-তে অ্যাকশন (Seen/Typing) পাঠানোর ফাংশন
async function sendAction(sender_id, action) {
  try {
    await axios.post(
      `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      { recipient: { id: sender_id }, sender_action: action }
    );
  } catch (error) {
    console.error(`Action Error (${action}):`, error.message);
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

            // প্রোফাইল ডাটা সংগ্রহ (নাম ও লিঙ্গ)
            const profile = await getUserProfile(sender_id);

            // ১. ৩ সেকেন্ড পর সিন (Seen) হবে
            await sleep(3000); 
            await sendAction(sender_id, 'mark_seen');

            // ২. টাইপিং শুরু করা (ডট ডট এনিমেশন)
            await sleep(500); 
            await sendAction(sender_id, 'typing_on');

            // ৩. ব্যাকগ্রাউন্ডে AI উত্তর তৈরি করা
            const aiReplyPromise = getAIReply(userMsg, profile.first_name, profile.gender);

            // ৪. ৫ সেকেন্ড টাইপিং সিগন্যাল নিশ্চিত করা
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
              console.error('Final Message Send Error:', e.message);
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    return res.status(404).end();
  }
};

// প্রফেশনাল সেলস ম্যানেজার AI লজিক
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
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত ঝানু এবং মার্জিত সিনিয়র সেলস ম্যানেজার। আপনার কাজ যান্ত্রিকভাবে তথ্য দেয়া নয়, বরং কাস্টমারের সাথে সম্পর্ক তৈরি করে সেল নিশ্চিত করা।

          আপনার নির্দেশিকা:
          ১. **স্মার্ট সম্বোধন:** শুধুমাত্র প্রথম রিপ্লাইয়ে "জি ${name} ${title}" বলবেন। পরবর্তী আলাপকালে বারবার নাম বা টাইটেল নেওয়ার কোনো দরকার নেই। একদম ন্যাচারাল মানুষের মতো কথা বলুন।
          ২. **প্রাইস অবজেকশন হ্যান্ডলিং:** কাস্টমার যদি বলে "দাম বেশি", তবে সরাসরি উত্তর না দিয়ে বলুন— "জি স্যার, আপনার কথা বুঝতে পারছি। তবে আমাদের এই কাপড়টি প্রিমিয়াম কোয়ালিটির এবং এর নিখুঁত ফিনিশিং ও কালার গ্যারান্টি আপনার বাজেটকে সার্থক করবে। আপনি একবার ট্রাই করলে কোয়ালিটি নিজেই বুঝতে পারবেন।"
          ৩. **অভিযোগ হ্যান্ডলিং:** আগের কোনো সমস্যা নিয়ে বললে আগে দুঃখ প্রকাশ করুন, সমস্যার কারণ জানতে চান এবং সমাধান দিন। 
          ৪. **সেলস ক্লোজিং:** উত্তর শেষ করার পর কৌশলে কাস্টমারকে অর্ডার করতে বা নতুন কালেকশন দেখতে উৎসাহিত করুন। 
          ৫. **ভাষা ও স্টাইল:** বাংলিশ বা শুদ্ধ বাংলা—কাস্টমার যেভাবে লেখে আপনি সেভাবেই প্রফেশনাল কিন্তু সাবলীল শুদ্ধ বাংলায় উত্তর দিন। m, l, xl-এর বদলে সুন্দর করে "মিডিয়াম, লার্জ" লিখুন। 
          ৬. **ডাটা সোর্স:** ${JSON.stringify(products)}। এই তালিকার তথ্য ব্যবহার করুন কিন্তু সেটি যেন রোবটিক না শোনায়।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.7
    },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}
