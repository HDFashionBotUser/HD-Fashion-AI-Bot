const axios = require('axios');

// নির্দিষ্ট সময় অপেক্ষা করার ফাংশন (Delay function)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    if (mode && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).end();
    }
  }

  // মেসেজ প্রসেসিং (POST Method)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        
        // ১. মেসেঞ্জার মেসেজ হ্যান্ডেল করা (টাইমলাইন ভিত্তিক অটোমেশন)
        if (entry.messaging) {
          const webhook_event = entry.messaging[0];
          const sender_psid = webhook_event.sender.id;

          if (webhook_event.message && webhook_event.message.text) {
            const userMessage = webhook_event.message.text;

            // --- প্রফেশনাল হিউম্যান বিহেভিয়ার টাইমলাইন শুরু ---
            
            // ধাপ ১: কাস্টমার মেসেজ দেওয়ার ৩ সেকেন্ড পর 'Seen' করা
            await sleep(3000); 
            await sendSenderAction(sender_psid, 'mark_seen');

            // ধাপ ২: সাথে সাথে 'Typing' সিগন্যাল চালু করা
            await sendSenderAction(sender_psid, 'typing_on');

            // ধাপ ৩: টাইপিং চলাকালীন সময়েই OpenAI থেকে বুদ্ধিমান উত্তর তৈরি করা (ব্যাকগ্রাউন্ডে)
            const aiReplyPromise = getAIReply(userMessage, 'messenger');

            // ধাপ ৪: পরবর্তী ৪ সেকেন্ড টাইপিং সিগন্যাল ধরে রাখা (টোটাল ৭ সেকেন্ড প্রসেস)
            await sleep(4000); 

            // ধাপ ৫: OpenAI থেকে আসা উত্তর সংগ্রহ এবং সাথে সাথে পাঠানো
            try {
              const aiReply = await aiReplyPromise;
              await axios.post(
                `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                {
                  recipient: { id: psid || sender_psid },
                  message: { text: aiReply }
                }
              );
            } catch (error) {
              console.error('Messenger Send Error:', error.message);
            }
            // --- টাইমলাইন শেষ ---
          }
        }

        // ২. ফেসবুক পাবলিক কমেন্ট হ্যান্ডেল করা (আগের মতোই ১.৫ মিনিট গ্যাপে)
        if (entry.changes) {
          const change = entry.changes[0];
          if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
            const comment_id = change.value.comment_id;
            const comment_text = change.value.message;

            await sleep(90000); // ১.৫ মিনিট পর কমেন্টের উত্তর

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

// AI থেকে উত্তর আনার প্রফেশনাল 'সেলস মেন্টর' ফাংশন
async function getAIReply(message, type) {
  // গুগল শিট থেকে প্রোডাক্ট ডেটা ফেচ করা
  const sheetResponse = await axios.get(process.env.PRODUCT_DATA_API_URL);
  const products = sheetResponse.data;
  
  const openaiResponse = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `আপনি 'HD Fashion' এর একজন অত্যন্ত দক্ষ এবং প্রফেশনাল সিনিয়র সেলস মেন্টর। আপনার লক্ষ্য শুধু উত্তর দেওয়া নয়, বরং কাস্টমারের সাথে একটি গভীর সুসম্পর্ক তৈরি করে সেল নিশ্চিত করা।

          আপনার ব্যক্তিত্ব ও উত্তর প্রদানের নীতিমালা:
          ১. **সম্মান ও আভিজাত্য:** উত্তরের শুরুতে "জি স্যার/ম্যাম" এবং শেষে "ধন্যবাদ" বা "শুভ কামনা" ব্যবহার করুন। আপনার ভাষা হবে অত্যন্ত নম্র, মার্জিত এবং প্রাঞ্জল। 
          ২. **কাস্টমার পালস রিডিং:** কাস্টমারের কথা শুনে তার আগ্রহের জায়গাটি বুঝুন। যদি কাস্টমার নেতিবাচক কথা বলে, তবে তর্কে না গিয়ে কৌশলে বিনয়ের সাথে তা সামলান। (উদাহরণ: "আপনার মতামত আমাদের কাছে অত্যন্ত মূল্যবান স্যার, বিষয়টি নিয়ে আমি এখনই আমাদের টিমের সাথে কথা বলছি। তবে আমাদের এই নতুন কালেকশনটি আপনার পছন্দ হতে পারে...")
          ৩. **হিউম্যান টাচ:** যান্ত্রিক উত্তর এড়িয়ে যান। কাস্টমার যদি বাংলিশে লেখে, তাকে বিশুদ্ধ বাংলায় এবং সুন্দর ফন্টে উত্তর দিন। যেন মনে হয় ওপারে একজন দরদী মানুষ বসে আছে।
          ৪. **সেলস ক্লোজিং টেকনিক:** কাস্টমারকে পজিটিভলি কনভেন্স করুন। পণ্যের বিশেষত্ব এমনভাবে তুলে ধরুন যাতে সে কিনতে আগ্রহী হয়। 
          ৫. **প্রোডাক্ট গাইড:** শুধুমাত্র এই প্রোডাক্ট লিস্ট থেকে সঠিক তথ্য দিন: ${JSON.stringify(products)}। স্টক না থাকলে "দুঃখিত না" না বলে, অল্টারনেটিভ ডিজাইন দেখানোর অফার দিন।
          ৬. **প্ল্যাটফর্ম গাইড:** কমেন্টে উত্তর হবে সংক্ষিপ্ত ও আকর্ষণীয় (ইনবক্সে আসার আমন্ত্রণসহ), আর ইনবক্সে উত্তর হবে বিস্তারিত এবং বন্ধুত্বপূর্ণ।` 
        },
        { role: 'user', content: message }
      ],
      temperature: 0.75, // উত্তরকে আরও সৃজনশীল ও মানুষের মতো করার জন্য
      max_tokens: 500
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
