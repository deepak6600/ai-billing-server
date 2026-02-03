const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. फायरबेस एडमिन सेटअप
// यहाँ Environment Variable से डेटा लिया जा रहा है ताकि सुरक्षा बनी रहे
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
const app = express();
app.use(bodyParser.json());

// Razorpay का सीक्रेट पासवर्ड (Webhook Secret)
const RAZORPAY_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// 2. पेमेंट रिसीव करने वाला पॉइंट (Webhook URL)
app.post('/webhook/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);

  // सुरक्षा जाँच: यह सुनिश्चित करना कि डेटा Razorpay से ही आया है
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_SECRET)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error("सुरक्षा अलर्ट: अमान्य सिग्नेचर!");
    return res.status(400).send('Invalid signature');
  }

  const event = req.body.event;
  const paymentData = req.body.payload.payment.entity;

  // यदि भुगतान सफलतापूर्वक पूरा हो गया है
  if (event === 'payment.captured') {
    const userId = paymentData.notes.userId; // यूजर की ID (ऐप से भेजी गई)
    const planType = paymentData.notes.plan; // प्लान का नाम (basic_499, premium_999, आदि)

    if (!userId) return res.status(400).send('User ID missing');

    try {
      // यूजर की रिक्वेस्ट के अनुसार अपडेटेड प्लान लिमिट्स
      let limits = { image: 0, video: 0, audio: 0 };
      
      if (planType === 'basic_499') {
        // बेसिक प्लान: 50 इमेज, 20 वीडियो, 20 ऑडियो
        limits = { image: 50, video: 20, audio: 20 };
      } else if (planType === 'premium_999') {
        // प्रीमियम प्लान: 500 इमेज, 100 वीडियो, 100 ऑडियो (पिछला बेसिक प्लान)
        limits = { image: 500, video: 100, audio: 100 };
      } else if (planType === 'unlimited_2499') {
        // अनलिमिटेड प्लान: बहुत अधिक लिमिट (999999)
        limits = { image: 999999, video: 999999, audio: 999999 };
      }

      // फायरबेस डेटाबेस में यूजर की लिमिट अपडेट करना
      const subRef = db.ref(`user_subscriptions/${userId}`);
      const snapshot = await subRef.once('value');
      const existingData = snapshot.val() || { maxLimitImage: 0, maxLimitVideo: 0, maxLimitAudio: 0 };

      // नई लिमिट को मौजूदा लिमिट में जोड़ना (Stacking)
      await subRef.update({
        maxLimitImage: (existingData.maxLimitImage || 0) + limits.image,
        maxLimitVideo: (existingData.maxLimitVideo || 0) + limits.video,
        maxLimitAudio: (existingData.maxLimitAudio || 0) + limits.audio,
        lastPaymentId: paymentData.id,
        currentPlan: planType,
        updatedAt: admin.database.ServerValue.TIMESTAMP
      });

      console.log(`सफलता: यूजर ${userId} के लिए ${planType} सक्रिय किया गया।`);
      res.status(200).send('OK');
    } catch (error) {
      console.error("फायरबेस अपडेट त्रुटि:", error);
      res.status(500).send('Error updating limits');
    }
  } else {
    res.status(200).send('Event ignored');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));