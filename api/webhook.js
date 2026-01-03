const axios = require('axios');

// নির্দিষ্ট সময় অপেক্ষা করার ফাংশন
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// মেটা থেকে কাস্টমারের নাম ও লিঙ্গ সংগ্রহের ফাংশন
async function getUserProfile(psid) {
  try {
    const response = await axios.get(`https://graph.facebook.com/${psid}?fields=first_name,gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return response.data;
  } catch (error) {
    console.error('User Profile Error:', error.message);
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
  // Webhook ভেরিফিকেশন (GET Method)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === process.env.VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).end();
  }

  // মেসেজ প্রসেসিং (POST Method)
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object === 'page') {
      for (const entry of body.entry) {
        if (entry.messaging) {
          const webhook_event = entry.messaging[0];
          const sender_psid = webhook_event.sender.id;

          if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            // ১. প্রোফাইল থেকে তথ্য নেওয়া
            const profile = await getUserProfile(sender_psid);
            const firstName = profile.first_name;
            const title = profile.gender === 'male' ? 'স্যার' : (profile.gender === 'female' ? 'ম্যাম' : '');

            // ২. ৩ সেকেন্ড পর সিন হওয়া
            await sleep(3000); 
            await sendSenderAction(sender_psid, 'mark_seen');

            // ৩. টাইপিং সিগন্যাল শুরু (৫০০ মিলি-সেকেন্ড গ্যাপ দিয়ে নিশ্চিত করা)
            await sleep(500); 
            await sendSenderAction(sender_psid, 'typing_on');

            // ৪. ৪ সেকেন্ড টাইপিং চলাকালীন AI উত্তর তৈরি করবে
            const aiReplyPromise = getAIReply(userMessage, firstName, title);
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

// AI থেকে উত্তর আনার প্রফেশনাল 'সেলস মেন্টর' ফাংশন
async function getAIReply(message, name, title) {
  const sheetResponse = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheetResponse.data;
  
  const openaiResponse = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত দক্ষ সিনিয়র সেলস এক্সিকিউটিভ। আপনার লক্ষ্য কাস্টমারকে আপন করে সেল নিশ্চিত করা।
          
          আপনার নীতিমালা:
          ১. **সম্মোধন:** আপনার প্রথম মেসেজে কাস্টমারকে "জি ${name} ${title}" বলে সম্বোধন করুন। পরবর্তী কনভারসেশনে বারবার এটি বলার দরকার নেই।
          ২. **প্রফেশনালিজম:** বারবার "ধন্যবাদ" বলে মেসেজ বড় করবেন না। যান্ত্রিকতা এড়িয়ে হিউম্যান বিহেভিয়ার অনুযায়ী সরাসরি এবং ইনফরমেটিভ উত্তর দিন।
          ৩. **ভাষা:** কাস্টমার বাংলিশে লিখলে আপনি অবশ্যই সাবলীল ও শুদ্ধ বাংলায় উত্তর দিবেন।
          ৪. **পালস বুঝে উত্তর:** কাস্টমারের প্রশ্নের গুরুত্ব বুঝুন। নেগেটিভ মেসেজ দিলে কৌশলে এবং নম্রভাবে তাকে কনভেন্স করুন। 
          ৫. **প্রোডাক্ট লিস্ট:** ${JSON.stringify(products)}। এই তালিকার বাইরে কোনো তথ্য দিবেন না।
          ৬. **টাইপিং সিগন্যাল:** মনে রাখবেন, আপনি টাইপ করছেন এমন একটি লুক দিতে হবে, তাই উত্তর সরাসরি টু-দ্য-পয়েন্ট এবং আকর্ষণীয় হবে।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.7
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
