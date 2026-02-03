const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. Firebase Admin Setup
// यह लाइन Render के Environment Variable से आपकी JSON Key उठाएगी
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
const app = express();
app.use(bodyParser.json());

const RAZORPAY_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// 2. Webhook Endpoint
app.post('/webhook/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_SECRET)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error("Signature Mismatch!");
    return res.status(400).send('Invalid signature');
  }

  const event = req.body.event;
  const paymentData = req.body.payload.payment.entity;

  // Razorpay notes से userId और plan निकालना
  const userId = paymentData.notes ? paymentData.notes.userId : null;
  const planType = paymentData.notes ? paymentData.notes.plan : null;

  console.log(`Event: ${event}, UserID: ${userId}, Plan: ${planType}`);

  if (event === 'payment.captured') {
    if (!userId) {
      console.error("Error: User ID missing in payment notes");
      return res.status(400).send('User ID missing');
    }

    try {
      let limits = { image: 0, video: 0, audio: 0 };
      
      // प्लान के अनुसार लिमिट तय करना
      if (planType === 'basic_499') {
        limits = { image: 50, video: 20, audio: 20 };
      } else if (planType === 'premium_999') {
        limits = { image: 500, video: 100, audio: 100 };
      } else if (planType === 'unlimited_2499') {
        limits = { image: 999999, video: 999999, audio: 999999 };
      }

      // **महत्वपूर्ण बदलाव:** अब हम 'user_subscriptions' की जगह 'All_Users_List' में अपडेट करेंगे
      // ताकि यह आपके ऐप और डेटाबेस स्ट्रक्चर से मैच करे।
      const userRef = db.ref(`All_Users_List/${userId}`);
      
      // मौजूदा डेटा पढ़ें
      const snapshot = await userRef.once('value');
      const existingData = snapshot.val() || {};

      // मौजूदा लिमिट (अगर है) में नई लिमिट जोड़ें
      const currentImage = existingData.maxLimitImage || 0;
      const currentVideo = existingData.maxLimitVideo || 0;
      const currentAudio = existingData.maxLimitAudio || 0;

      await userRef.update({
        maxLimitImage: currentImage + limits.image,
        maxLimitVideo: currentVideo + limits.video,
        maxLimitAudio: currentAudio + limits.audio,
        lastPaymentId: paymentData.id, // पेमेंट ID सेव करें ताकि रिकॉर्ड रहे
        currentPlan: planType,
        updatedAt: admin.database.ServerValue.TIMESTAMP
      });

      console.log(`Success: Limits updated directly in All_Users_List for User ${userId}`);
      res.status(200).send('OK');
    } catch (error) {
      console.error("Database Error:", error);
      res.status(500).send('Database Error');
    }
  } else {
    res.status(200).send('Event ignored');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));