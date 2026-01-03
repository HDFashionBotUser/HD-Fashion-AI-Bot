const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// প্রোফাইল থেকে শুধু লিঙ্গ (Gender) সংগ্রহ করার ফাংশন
async function getUserGender(sender_id) {
  try {
    const res = await axios.get(`https://graph.facebook.com/${sender_id}?fields=gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return res.data.gender;
  } catch (error) {
    return 'unknown';
  }
}

// সিন এবং টাইপিং অ্যাকশন পাঠানোর ফাংশন
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

          if (webhook_event.message && webhook_event.message.text) {
            const userMsg = webhook_event.message.text;

            // ৩ সেকেন্ড পর সিন এবং টাইপিং শুরু (টাইপিং ডট ডট এনিমেশন নিশ্চিত করতে)
            await sleep(3000); 
            await sendAction(sender_id, 'mark_seen');
            await sleep(500); 
            await sendAction(sender_id, 'typing_on');

            // জেন্ডার অনুযায়ী সম্বোধন ঠিক করা
            const gender = await getUserGender(sender_id);
            const aiReplyPromise = getAIReply(userMsg, gender);
            
            // ৫ সেকেন্ড টাইপিং এনিমেশন শো করাবে
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
      return res.status(200).send('EVENT_RECEIVED');
    }
  }
};

async function getAIReply(message, gender) {
  const sheet = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheet.data;
  const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : 'স্যার/ম্যাম');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত দক্ষ এবং মার্জিত সিনিয়র সেলস ম্যানেজার। আপনার লক্ষ্য হলো গ্রাহককে কনভেন্স করে সেল নিশ্চিত করা।

          আপনার নির্দেশিকা:
          ১. **সম্বোধন:** নাম ধরে ডাকার প্রয়োজন নেই। শুধু ছেলে হলে "${title}" এবং মেয়ে হলে "${title}" বলে সম্বোধন করবেন। 
          ২. **সেলস স্ট্র্যাটেজি:** কাস্টমারের সাথে কথা বলার সময় কৌশলে জিজ্ঞেস করুন— "${title}, আপনি কোন প্রোডাক্টটি নিতে চাচ্ছেন? দয়া করে আমাকে ছবি অথবা প্রোডাক্ট কোডটি দিন।"
          ৩. **প্রাইস অবজেকশন:** কাস্টমার যদি বলে "দাম বেশি", তবে কোনো ডিসকাউন্ট দিবেন না। পরিবর্তে আমাদের কাপড়ের গুণগত মান, প্রিমিয়াম ফেব্রিক এবং উন্নত ফিনিশিংয়ের কথা উল্লেখ করে কেন দামটি যুক্তিসঙ্গত তা বুঝিয়ে বলুন।
          ৪. **ডেলিভারি চার্জ:** ঢাকার মধ্যে ৮০ টাকা এবং ঢাকার বাইরে ১৫০ টাকা। 
          ৫. **নেগেটিভ মেসেজ হ্যান্ডলিং:** কোনো নেতিবাচক কথা বললে আন্তরিকভাবে দুঃখ প্রকাশ করে পজিটিভ এবং ইনফরমেটিভ উত্তর দিন। 
          ৬. **ভাষা ও টোন:** অত্যন্ত নম্র, ভদ্র এবং সাবলীল শুদ্ধ বাংলা ব্যবহার করুন। উত্তর হবে সংক্ষিপ্ত কিন্তু অত্যন্ত তথ্যবহুল এবং প্রফেশনাল। কোনো যান্ত্রিক চিহ্ন বা ড্যাশ ব্যবহার করবেন না।
          ৭. **প্রোডাক্ট ডাটা:** ${JSON.stringify(products)}।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.7
    },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}
