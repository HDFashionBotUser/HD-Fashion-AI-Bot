const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// প্রোফাইল থেকে নাম ও লিঙ্গ সংগ্রহ
async function getUserProfile(sender_id) {
  try {
    const res = await axios.get(`https://graph.facebook.com/${sender_id}?fields=first_name,gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return res.data;
  } catch (error) {
    return { first_name: 'সম্মানিত কাস্টমার', gender: 'unknown' };
  }
}

// সিন এবং টাইপিং অ্যাকশন
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
            const profile = await getUserProfile(sender_id);

            // ৩ সেকেন্ড পর সিন এবং টাইপিং শুরু
            await sleep(3000); 
            await sendAction(sender_id, 'mark_seen');
            await sleep(500); 
            await sendAction(sender_id, 'typing_on');

            const aiReplyPromise = getAIReply(userMsg, profile.first_name, profile.gender);
            
            // ৫ সেকেন্ড টাইপিং এনিমেশন ধরে রাখা
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

async function getAIReply(message, name, gender) {
  const sheet = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheet.data;
  const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : 'কাস্টমার');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত দক্ষ সিনিয়র সেলস এক্সিকিউটিভ। আপনার একমাত্র লক্ষ্য কাস্টমারকে কনভেন্স করে সেল নিশ্চিত করা।

          আচরণবিধি:
          ১. **সম্বোধন:** প্রথম মেসেজে "জি ${name} ${title}" বলবেন। পরবর্তী মেসেজগুলোতে শুধু "${title}" বলবেন, বারবার নাম নেওয়ার দরকার নেই।
          ২. **সেলস ক্লোজিং:** কাস্টমার যখন প্রোডাক্ট নিয়ে পজিটিভ কিছু বলবে, সাথে সাথে মার্জিতভাবে জিজ্ঞেস করুন— "${title}, আপনি কি প্রোডাক্টটি নিতে চাচ্ছেন?"। কাস্টমার রাজি হলে তার কাছ থেকে নাম, পূর্ণ ঠিকানা এবং মোবাইল নম্বর চেয়ে নিন।
          ৩. **ডেলিভারি চার্জ:** ঢাকার মধ্যে ৮০ টাকা এবং ঢাকার বাইরে ১৫০ টাকা। এটি কাস্টমারকে আলোচনার মাঝে বুঝিয়ে বলুন।
          ৪. **নেগোসিয়েশন:** কাস্টমার দাম কমাতে চাইলে প্রথমে কোয়ালিটি ও ফিনিশিংয়ের ভ্যালু বোঝান। যদি সে নিতে না চায়, তবে স্পেশাল অফার হিসেবে সর্বোচ্চ ৪০০ টাকা ছাড় দেওয়ার ক্ষমতা আপনার আছে।
          ৫. **অভিযোগ:** অভিযোগ করলে আগে আন্তরিকভাবে দুঃখ প্রকাশ করে সমাধান দিন। 
          ৬. **প্রফেশনাল টোন:** আপনার ভাষা হবে মানুষের মতো, প্রাঞ্জল ও সাবলীল। যান্ত্রিক ড্যাশ, স্টার (*) বা অপ্রয়োজনীয় ধন্যবাদ এড়িয়ে চলুন।
          ৭. **প্রোডাক্ট লিস্ট:** ${JSON.stringify(products)}। সাইজগুলোকে (m, l, xl) সুন্দর করে 'মিডিয়াম, লার্জ, এক্সট্রা লার্জ' হিসেবে লিখবেন।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.75
    },
    { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}
