const axios = require('axios');

// নির্দিষ্ট সময় অপেক্ষা করার ফাংশন
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// কাস্টমারের প্রোফাইল (নাম ও লিঙ্গ) ডাটা পাওয়ার ফাংশন
async function getUserProfile(psid) {
  try {
    const response = await axios.get(`https://graph.facebook.com/${psid}?fields=first_name,gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return response.data;
  } catch (error) {
    console.error('Profile Error:', error.message);
    return { first_name: 'সম্মানিত কাস্টমার', gender: 'unknown' };
  }
}

// মেটা এপিআই-তে সিন বা টাইপিং সিগন্যাল পাঠানোর ফাংশন
async function sendSenderAction(sender_psid, action) {
  try {
    await axios.post(
      `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: sender_psid },
        sender_action: action
      }
    );
  } catch (error) {
    console.error(`Error sending ${action}:`, error.message);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === process.env.VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).end();
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (body.object === 'page') {
      for (const entry of body.entry) {
        if (entry.messaging) {
          const webhook_event = entry.messaging[0];
          const sender_psid = webhook_event.sender.id;

          if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            // প্রোফাইল তথ্য সংগ্রহ
            const profile = await getUserProfile(sender_psid);

            // ধাপ ১: ৩ সেকেন্ড পর সিন (Seen) করা
            await sleep(3000); 
            await sendSenderAction(sender_psid, 'mark_seen');

            // ধাপ ২: টাইপিং সিগন্যাল চালু করা (ডট ডট এনিমেশন)
            await sleep(500); // সিন এবং টাইপিং এর মাঝে সামান্য গ্যাপ
            await sendSenderAction(sender_psid, 'typing_on');

            // ধাপ ৩: OpenAI উত্তর তৈরি করবে
            const aiReplyPromise = getAIReply(userMessage, profile.first_name, profile.gender);

            // ধাপ ৪: পরবর্তী ৪ সেকেন্ড টাইপিং এনিমেশন ধরে রাখা
            await sleep(4000); 

            try {
              const aiReply = await aiReplyPromise;
              await axios.post(
                `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                {
                  recipient: { id: sender_psid },
                  message: { text: aiReply }
                }
              );
            } catch (error) {
              console.error('Messenger Send Error:', error.message);
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    return res.status(404).end();
  }
};

async function getAIReply(message, name, gender) {
  const sheetResponse = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheetResponse.data;
  const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : '');
  
  const openaiResponse = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন সিনিয়র সেলস এক্সিকিউটিভ মেন্টর। 
          
          আপনার আচরণবিধি:
          ১. **সম্বোধন ও নাম:** শুরুতে "জি ${name} ${title}" বলবেন। এরপর স্বাভাবিক আলাপ করবেন।
          ২. **অভিযোগ ও সমবেদনা:** কাস্টমার যদি সমস্যার কথা বলে (যেমন: প্রোডাক্ট খারাপ হয়েছে), তবে তর্কে না গিয়ে আন্তরিকভাবে দুঃখ প্রকাশ করুন। সমস্যার নির্দিষ্ট কারণ জানতে চান এবং সমাধান দিন। (যেমন: "শুনে খুব খারাপ লাগলো স্যার, আমরা বিষয়টি গুরুত্ব দিয়ে দেখছি। আপনার কি নির্দিষ্ট কোনো সমস্যা হয়েছিল?")
          ৩. **আশ্বস্ত করা ও অনুমতি:** কাস্টমারকে আশ্বস্ত করুন যে পরবর্তীতে এমন হবে না। তারপর অত্যন্ত কৌশলে আমাদের "নতুন কি কি কালেকশন" আছে তা দেখার জন্য অনুমতি চান। সরাসরি প্রোডাক্ট লিস্ট চাপিয়ে দিবেন না। 
          ৪. **প্রোডাক্ট ভ্যালু:** পণ্যের কোয়ালিটি এবং প্রাইস কেন লাভজনক তা বুঝিয়ে বলুন যাতে গ্রাহক কনভেন্স হয়।
          ৫. **প্রোডাক্ট ডাটা:** ${JSON.stringify(products)}। এই ডাটাগুলো প্রফেশনাল ভাষায় ব্যবহার করুন (যেমন: m, l এর বদলে মিডিয়াম, লার্জ লিখুন)। 
          ৬. **যান্ত্রিকতা পরিহার:** উত্তর হবে হিউম্যান লাইক, প্রাঞ্জল এবং সাবলীল। বারবার ধন্যবাদ বা ফালতু স্টার মার্কস ব্যবহার করবেন না।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.8
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return openaiResponse.data.choices[0].message.content;
}
