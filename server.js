const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. Firebase Admin Setup
// Render के Environment Variables से डेटा लिया जाएगा
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
    return res.status(400).send('Invalid signature');
  }

  const event = req.body.event;
  const paymentData = req.body.payload.payment.entity;

  if (event === 'payment.captured') {
    const userId = paymentData.notes.userId;
    const planType = paymentData.notes.plan;

    if (!userId) return res.status(400).send('User ID missing');

    try {
      let limits = { image: 0, video: 0, audio: 0 };
      
      // आपके बताए अनुसार लिमिट्स
      if (planType === 'basic_499') {
        limits = { image: 50, video: 20, audio: 20 };
      } else if (planType === 'premium_999') {
        limits = { image: 500, video: 100, audio: 100 };
      } else if (planType === 'unlimited_2499') {
        limits = { image: 999999, video: 999999, audio: 999999 };
      }

      const subRef = db.ref(`user_subscriptions/${userId}`);
      const snapshot = await subRef.once('value');
      const existingData = snapshot.val() || { maxLimitImage: 0, maxLimitVideo: 0, maxLimitAudio: 0 };

      await subRef.update({
        maxLimitImage: (existingData.maxLimitImage || 0) + limits.image,
        maxLimitVideo: (existingData.maxLimitVideo || 0) + limits.video,
        maxLimitAudio: (existingData.maxLimitAudio || 0) + limits.audio,
        lastPaymentId: paymentData.id,
        currentPlan: planType,
        updatedAt: admin.database.ServerValue.TIMESTAMP
      });

      res.status(200).send('OK');
    } catch (error) {
      res.status(500).send('Error');
    }
  } else {
    res.status(200).send('Event ignored');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));