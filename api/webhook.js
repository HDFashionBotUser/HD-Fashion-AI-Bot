const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ছবিকে সরাসরি ডাটাতে (Base64) রূপান্তর করার ফাংশন
async function getImageBase64(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary').toString('base64');
  } catch (error) {
    console.error('Image Conversion Error:', error.message);
    return null;
  }
}

// ফেসবুক থেকে ইউজারের জেন্ডার জানার ফাংশন
async function getUserGender(sender_id) {
  try {
    const res = await axios.get(`https://graph.facebook.com/${sender_id}?fields=gender&access_token=${process.env.PAGE_ACCESS_TOKEN}`);
    return res.data.gender;
  } catch (error) {
    return 'unknown';
  }
}

// ফেসবুক মেসেঞ্জারে অ্যাকশন (Seen/Typing) পাঠানোর ফাংশন
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
                // এআই থেকে উত্তর আনা
                const aiReply = await getAIReply(userMsg, imageUrl, gender);
                
                // টাইপিং ইফেক্ট বজায় রাখতে মোট ৭ সেকেন্ড পূর্ণ করা (৩.৫ + ৩.৫ = ৭)
                await sleep(3500); 

                await axios.post(`https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
                  { recipient: { id: sender_id }, message: { text: aiReply } }
                );
              } catch (e) { 
                console.error('Webhook Post Error:', e.message); 
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
    if (message) {
      content.push({ type: "text", text: message });
    }

    if (imageUrl) {
      const base64Image = await getImageBase64(imageUrl);
      if (base64Image) {
        content.push({ 
          type: "text", 
          text: "Identify the product code from this image and provide data from the database. If no code is found, follow the fallback instruction." 
        });
        content.push({ 
          type: "image_url", 
          image_url: { 
            url: `data:image/jpeg;base64,${base64Image}`,
            detail: "high" 
          } 
        });
      }
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: `আপনি 'HD Fashion' এর একজন অত্যন্ত মার্জিত ও প্রফেশনাল সিনিয়র সেলস এক্সিকিউটিভ।
            
            আপনার নির্দেশিকা (কঠোরভাবে পালনীয়):
            ১. সম্বোধন: কাস্টমারকে সবসময় 'জি ${title},' বলে উত্তর শুরু করবেন।
            ২. অপ্রয়োজনীয় কথা বর্জন: "ছবিতে থাকা কোডটি হলো..." বা "এটি সম্পর্কে তথ্য হলো..." এই ধরণের বাক্য একদম বলবেন না। সরাসরি 'জি ${title},' এর পর প্রোডাক্টের ডিটেইলস দিয়ে দিবেন।
            ৩. ফরম্যাট: 
               জি ${title},
               [প্রোডাক্টের নাম/বিবরণ]
               মূল্য: [মূল্য] টাকা
               আকার: [আকার]
               [অন্যান্য তথ্য থাকলে]
               
               প্রোডাক্টটি অর্ডার করতে আপনার নাম, ঠিকানা, মোবাইল নাম্বার দিয়ে সহযোগিতা করুন। ধন্যবাদ।
            
            ৪. কোড শনাক্ত করতে না পারলে (Fallback): যদি ছবির কোডটি ডাটাবেসে না পান বা রিড করতে না পারেন, তবে ঠিক এই মেসেজটি দিবেন:
               "সরি ${title}, আমাদের ভিডিওতে অথবা প্রোডাক্টের ছবিতে প্রত্যেকটি প্রোডাক্ট এর জন্য একটি করে কোড দেওয়া রয়েছে। দয়া করে কোডটি টেক্সট করে সহযোগিতা করুন আমি আপনাকে বিস্তারিত জানাচ্ছি। ধন্যবাদ।"
            
            ৫. ভাষা: অত্যন্ত নম্র ও হিউম্যান-লাইক হবে।
            ৬. ডেলিভারি চার্জ: ঢাকা ৮০, ঢাকার বাইরে ১৫০।
            
            আপনার প্রোডাক্ট ডাটাবেস: ${JSON.stringify(products)}` 
          },
          { role: 'user', content: content }
        ],
        temperature: 0.3, // উত্তর যেন একদম টু-দ্য-পয়েন্ট হয়
        max_tokens: 500
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    const title = gender === 'male' ? 'স্যার' : (gender === 'female' ? 'ম্যাম' : 'স্যার/ম্যাম');
    return `সরি ${title}, আমাদের ভিডিওতে অথবা প্রোডাক্টের ছবিতে প্রত্যেকটি প্রোডাক্ট এর জন্য একটি করে কোড দেওয়া রয়েছে। দয়া করে কোডটি টেক্সট করে সহযোগিতা করুন আমি আপনাকে বিস্তারিত জানাচ্ছি। ধন্যবাদ।`;
  }
}
