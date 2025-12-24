const axios = require('axios');

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
        const webhook_event = entry.messaging[0];
        const sender_psid = webhook_event.sender.id;

        if (webhook_event.message && webhook_event.message.text) {
          const userMessage = webhook_event.message.text;

          try {
            // ১. গুগল শিট থেকে ডাটা আনা
            const sheetResponse = await axios.get(process.env.PRODUCT_DATA_API_URL);
            const products = sheetResponse.data;
            const productContext = JSON.stringify(products);

            // ২. OpenAI থেকে উত্তর তৈরি করা
            const openaiResponse = await axios.post(
              'https://api.openai.com/v1/chat/completions',
              {
                model: 'gpt-3.5-turbo',
                messages: [
                  { role: 'system', content: `You are a helpful assistant for HD Fashion. Use this product list to answer: ${productContext}. If not in list, answer generally.` },
                  { role: 'user', content: userMessage }
                ]
              },
              {
                headers: {
                  'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                  'Content-Type': 'application/json'
                }
              }
            );

            const aiReply = openaiResponse.data.choices[0].message.content;

            // ৩. ফেসবুকে উত্তর পাঠানো
            await axios.post(
              `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
              {
                recipient: { id: sender_psid },
                message: { text: aiReply }
              }
            );
          } catch (error) {
            console.error('Error:', error.response ? error.response.data : error.message);
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).end();
    }
  }
};
