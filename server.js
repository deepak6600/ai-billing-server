const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Firebase Admin Setup
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
const app = express();
app.use(bodyParser.json());

const RAZORPAY_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

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

  // Razorpay notes se data nikalna
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

      console.log(`Success: Limits updated for User ${userId}`);
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