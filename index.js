// index.js - Appwrite Function Code

const sdk = require('node-appwrite');

/*
  'req' و 'res' هما request و response. غنحتاجوهم باش نجاوبو Appwrite ونقولو ليه واش خدمتنا دازت مزيان.
  'log' هي بحال console.log ولكن خاصة بـ Appwrite.
  'error' كتسجل الأخطاء فـ logs ديال Appwrite.
*/
module.exports = async function ({ req, res, log, error }) {
  const client = new sdk.Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new sdk.Databases(client);
  const messaging = new sdk.Messaging(client);

  log('Function started: Checking for due review cards...');

  try {
    // 1. جلب كل البطاقات اللي تاريخ المراجعة ديالها فات
    const now = new Date().toISOString();
    const response = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_CARDS_COLLECTION_ID,
      [sdk.Query.lessThanEqual('nextReviewDate', now)]
    );

    if (response.total === 0) {
      log('No cards are due for review. Function finished successfully.');
      return res.json({ success: true, message: 'No cards due for review.' });
    }

    log(`Found ${response.total} cards due for review. Grouping by user...`);

    // 2. تجميع البطاقات حسب كل مستخدم
    // غنصاوبو object بحال هكا: { "userId1": 5, "userId2": 12 }
    const usersToNotify = {};
    for (const card of response.documents) {
      if (!usersToNotify[card.userId]) {
        usersToNotify[card.userId] = 0;
      }
      usersToNotify[card.userId]++;
    }

    log(`Found ${Object.keys(usersToNotify).length} users to notify.`);

    // 3. المرور على كل مستخدم وإرسال إشعار له
    for (const userId in usersToNotify) {
      log(`Processing user: ${userId}`);
      
      // جلب اشتراكات الإشعارات ديال هاد المستخدم
      const subResponse = await databases.listDocuments(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_SUBSCRIPTIONS_COLLECTION_ID,
        [sdk.Query.equal('userId', userId)]
      );

      if (subResponse.documents.length > 0) {
        const cardCount = usersToNotify[userId];
        const payload = JSON.stringify({
          title: '🔔 وقت المراجعة!',
          body: `لديك ${cardCount} بطاقة جاهزة للمراجعة.`,
        });

        log(`User ${userId} has ${subResponse.documents.length} devices to notify. Sending push...`);
        
        // إرسال الإشعار لكل جهاز (اشتراك) عند المستخدم
        for (const subDoc of subResponse.documents) {
          try {
            const subscription = JSON.parse(subDoc.subscriptionObject);
            await messaging.createPush(
              `review-${userId}-${Date.now()}`,
              "تذكير بالمراجعة", // هذا عنوان داخلي في Appwrite, لا يظهر للمستخدم
              payload,
              [], // topics
              [subscription.endpoint], // targets
              [], // users
              process.env.FCM_PROVIDER_ID
            );
          } catch(e) {
             error(`Failed to send notification to one of the devices for user ${userId}. Reason: ${e.message}`);
             // نكملو وخا يفشل واحد الجهاز
          }
        }
      } else {
        log(`User ${userId} has due cards but no push subscriptions found.`);
      }
    }

    log('Function finished processing all users.');
    res.json({ success: true, message: 'Notifications processed successfully.' });

  } catch (e) {
    error(`An error occurred: ${e.message}`);
    res.json({ success: false, error: e.message }, 500);
  }
};