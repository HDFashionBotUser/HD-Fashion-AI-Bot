 const axios = require('axios');

// নির্দিষ্ট সময় অপেক্ষা করার ফাংশন (Delay function)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).end();
    }
  }

  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        
        // ১. মেসেঞ্জার মেসেজ হ্যান্ডেল করা (৫-৬ সেকেন্ড ডিলয়)
        if (entry.messaging) {
          const webhook_event = entry.messaging[0];
          const sender_psid = webhook_event.sender.id;

          if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            await sleep(6000); // ৬ সেকেন্ড অপেক্ষা

            try {
              const aiReply = await getAIReply(userMessage, 'messenger');
              await axios.post(
                `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                {
                  recipient: { id: sender_psid },
                  message: { text: aiReply }
                }
              );
            } catch (error) {
              console.error('Messenger Error:', error.message);
            }
          }
        }

        // ২. ফেসবুক পাবলিক কমেন্ট হ্যান্ডেল করা (১.৫ মিনিট ডিলয়)
        if (entry.changes) {
          const change = entry.changes[0];
          if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
            const comment_id = change.value.comment_id;
            const comment_text = change.value.message;

            await sleep(90000); // ১.৫ মিনিট অপেক্ষা

            try {
              const aiReply = await getAIReply(comment_text, 'comment');
              await axios.post(
                `https://graph.facebook.com/v12.0/${comment_id}/comments?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                { message: aiReply }
              );
            } catch (error) {
              console.error('Comment Error:', error.message);
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).end();
    }
  }
};

// AI থেকে উত্তর আনার চূড়ান্ত প্রফেশনাল ফাংশন
async function getAIReply(message, type) {
  const sheetResponse = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheetResponse.data;
  
  const openaiResponse = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini', // দ্রুত ও সাশ্রয়ী প্রফেশনাল মডেল
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত দক্ষ, মার্জিত এবং অভিজ্ঞ সিনিয়র সেলস এক্সিকিউটিভ। আপনার মূল লক্ষ্য কাস্টমারকে আপন করে নেওয়া এবং তাকে সর্বোচ্চ সম্মান দিয়ে সঠিক তথ্য জানানো।

          আপনার আচরণের মূল নীতিমালা:
          ১. **ভাষা ও রূপান্তর:** কাস্টমার যদি ইংরেজি হরফে বাংলা (Banglish) লেখে (যেমন: "Price koto?"), আপনি অবশ্যই তার উত্তর শুদ্ধ ও সুন্দর বাংলায় দিবেন। আপনার বাংলা হবে সাবলীল, যান্ত্রিকতা মুক্ত এবং অত্যন্ত মার্জিত।
          ২. **ব্যক্তিত্ব:** আপনার প্রতিটি কথা থেকে নম্রতা ও আন্তরিকতা ঝরবে। আপনি শুধু তথ্য দিবেন না, একজন সাহায্যকারীর মতো কথা বলবেন। (যেমন: "জি ম্যাম, এই কালারটি আপনার জন্য একদম পারফেক্ট হবে।")
          ৩. **সম্বোধন:** উত্তরের শুরুতে "জি স্যার/ম্যাম" ব্যবহার করা বাধ্যতামূলক। কথা বলা শেষে "ধন্যবাদ" বা "শুভ কামনা" দিয়ে ইতি টানুন।
          ৪. **ডেটা সোর্স:** শুধুমাত্র এই প্রোডাক্ট লিস্টটি নিখুঁতভাবে ফলো করুন: ${JSON.stringify(products)}। লিস্টের বাইরে কোনো মনগড়া দাম বা সাইজ বলবেন না।
          ৫. **স্মার্ট সেলসম্যান টেকনিক:** যদি কোনো পণ্য স্টকে না থাকে, তবে সরাসরি 'না' বলবেন না। এভাবে বলুন: "জি স্যার, আপনার পছন্দের এই ড্রেসটি এই মুহূর্তে শেষ হয়ে গেছে। তবে আমি কি আপনাকে এর চেয়েও সুন্দর অন্য কিছু কালেকশন দেখাতে পারি?"
          ৬. **প্ল্যাটফর্ম ভেদে উত্তর:** - কমেন্টের ক্ষেত্রে: উত্তর হবে ছোট, মিষ্টি এবং আকর্ষণীয়। কাস্টমারকে ইনবক্সে আসার জন্য বিনয়ের সাথে আমন্ত্রণ জানান।
             - মেসেঞ্জারের ক্ষেত্রে: উত্তর হবে বিস্তারিত, তথ্যবহুল এবং বন্ধুত্বপূর্ণ।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.7 // উত্তরকে মানুষের মতো স্বাভাবিক করার জন্য
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
