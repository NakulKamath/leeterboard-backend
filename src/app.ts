import express, { NextFunction, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
// import apicache from 'apicache';
import {
  userStatusQuery,
  userSubmissionsQuery,
} from './GQLQueries/newQueries';
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const API_URL = process.env.LEETCODE_API_URL || 'https://leetcode.com/graphql';

// const cache = apicache.middleware;
// app.get('*', cache('5 minutes'));
app.use(cors());
app.use((req: express.Request, _res: Response, next: NextFunction) => {
  console.log('Requested URL:', req.originalUrl);
  next();
});

async function queryLeetCodeAPI(query: string, variables: any) {
  try {
    const response = await axios.post(API_URL, { query, variables });
    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`Error from LeetCode API: ${error.response.data}`);
    } else if (error.request) {
      throw new Error('No response received from LeetCode API');
    } else {
      throw new Error(`Error in setting up the request: ${error.message}`);
    }
  }
}

const {initializeApp} = require('firebase/app');
const { 
  getFirestore, 
  getDoc,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
} = require('firebase/firestore');
require('dotenv').config();
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

const firebase = initializeApp(firebaseConfig);
const db = getFirestore(firebase);

// app.get('*', (req, res) => {
//   console.log('Requested URL:', req.originalUrl);
//   res.json({
//     message: 'Welcome to LeetCode Groups API',
//   })
// });

app.get('/group/fetch/:group/:uuid/:code', express.json(), async (req, res) => {
  const groupName = req.params.group;
  const uuid = req.params.uuid;
  const code = req.params.code;

  if (!groupName) {
    return res.status(400).json({
      error: 'Group name is required in JSON body',
      example: { groupName: 'mygroup' },
      prompt: false
    });
  }

  try {
    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);
    
    if (!groupDoc.data()) {
      return res.json({
        success: false,
        error: 'Group does not exist, or was deleted.',
        groupName: groupName,
        prompt: false
      });
    }

    const groupData = groupDoc.data();
    const members = groupData?.members || [];
    const privacy = groupData?.privacy;
    const accountDocRef = doc(db, 'accounts', uuid);
    const accountDoc = await getDoc(accountDocRef);
    let username = null;
    if (accountDoc.exists()) {
      const accountData = accountDoc.data();
      username = accountData.username;
    }

    if (privacy && privacy === true && code !== groupData.secret && !(uuid !== "none" && uuid.startsWith('anon-') && members.includes(uuid.slice(5)))) {
      if (!accountDoc.exists()) {
        return res.json({
          success: false,
          error: 'Group is private. Please ask for an invite.',
          uuid: uuid,
          prompt: false
        });
      }
      if (code !== groupData.secret) {
        const accountData = accountDoc.data();
        const user = accountData.username;
        if (!members.includes(user)) {
          return res.json({
            success: false,
            error: 'You are not a member of this group. Please ask for an invite.',
            username: user,
            groupName: groupName
          });
        }
      }
    }

    const userPromises = members.map(async (username: string) => {
      try {
        const userData = await queryLeetCodeAPI(userSubmissionsQuery, { username });
        
        if (userData.errors) {
          return {
            username: username,
            questionsSolved: null,
            error: 'User not found'
          };
        }
        
        const name = userData.data.matchedUser.profile.realName || username;
        const questionsSolved = userData.data.matchedUser.submitStats.acSubmissionNum[0].count;
        const easySolved = userData.data.matchedUser.submitStats.acSubmissionNum[1].count;
        const mediumSolved = userData.data.matchedUser.submitStats.acSubmissionNum[2].count;
        const hardSolved = userData.data.matchedUser.submitStats.acSubmissionNum[3].count;
        const avatar = userData.data.matchedUser.profile.userAvatar || '';
        const points = easySolved + mediumSolved * 2 + hardSolved * 3;
        
        return {
          name: name,
          username: username,
          avatar: avatar,
          questionsSolved: questionsSolved,
          easy: easySolved,
          medium: mediumSolved,
          hard: hardSolved,
          points: points,
        };
      } catch (error) {
        return {
          username: username,
          questionsSolved: null,
          error: 'Failed to fetch user data'
        };
      }
    });
    
    const usersData = await Promise.all(userPromises);
    
    const sortedUsers = usersData.sort((a, b) => {
      if (a.points === undefined || a.points === null) return 1;
      if (b.points === undefined || b.points === null) return -1;
      if (b.points !== a.points) return b.points - a.points;
      if (a.questionsSolved === null) return 1;
      if (b.questionsSolved === null) return -1;
      return b.questionsSolved - a.questionsSolved;
    });

    return res.json({
      success: true,
      groupName: groupName,
      totalMembers: members.length,
      members: sortedUsers,
      prompt: ((username !== null && !members.includes(username)) || username === null && uuid.startsWith('anon-') && !members.includes(uuid.slice(5))) && code === groupData.secret,
      groupSecret: (username !== null && members.includes(username)) || (username === null && uuid.startsWith('anon-') && members.includes(uuid.slice(5))) ? groupData.secret : '',
    });
    
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/user/add-anon', express.json(), async (req, res) => {
  const { username, groupName, secret } = req.body;

  if (!groupName||!username) {
    return res.status(400).json({
      error: 'All fields are required',
      example: { username: 'john', groupName: 'mygroup' }
    });
  }

  try {
    const userData = await queryLeetCodeAPI(userStatusQuery, { username });

    if (userData.errors) {
      return res.status(404).json({
        error: 'User not found on LeetCode',
        username: username
      });
    }

    const userStatus = userData.data.matchedUser.profile.aboutMe || '';

    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);

    if (!groupDoc.data()) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }

    if (secret != groupDoc.data()?.secret) {
      return res.status(403).json({
        error: 'Invalid group secret',
        groupName: groupName
      });
    }

    const groupData = groupDoc.data();
    const groupSecret = groupData?.secret;
    const currentMembers = groupData?.members || [];

    if (!userStatus.includes(groupSecret)) {
      return res.status(403).json({
        error: 'Group secret not found in user status',
        message: `Please add "${groupSecret}" to your LeetCode profile status/about section`,
        username: username,
        currentStatus: userStatus
      });
    }

    if (currentMembers.includes(username)) {
      return res.status(409).json({
        error: 'User is already a member of this group',
        username: username,
        groupName: groupName
      });
    }

    const updatedMembers = [...currentMembers, username];

    await updateDoc(docRef, {
      members: updatedMembers
    });

    await userGroupHandler(username, groupName);

    return res.json({
      success: true,
      message: 'User successfully added to group'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/user/add', express.json(), async (req, res) => {
  const { uuid, groupName, secret } = req.body;

  if (!groupName||!uuid) {
    return res.status(400).json({
      error: 'All fields are required',
    });
  }

  try {
    const accountDocRef = doc(db, 'accounts', uuid);
    const accountDoc = await getDoc(accountDocRef);
    if (!accountDoc.exists()) {
      return res.status(404).json({
        error: 'Your account not linked. Please head to dashboard and link your account first.',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const username = accountData.username;

    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);

    if (!groupDoc.data()) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }

    if (secret != groupDoc.data()?.secret) {
      return res.status(403).json({
        error: 'Invalid group secret',
        groupName: groupName
      });
    }

    const groupData = groupDoc.data();
    const currentMembers = groupData?.members || [];

    if (currentMembers.includes(username)) {
      return res.status(409).json({
        error: 'User is already a member of this group',
        username: username,
        groupName: groupName
      });
    }

    const updatedMembers = [...currentMembers, username];

    await updateDoc(docRef, {
      members: updatedMembers
    });

    await userGroupHandler(username, groupName);

    return res.json({
      success: true,
      message: 'User successfully added to group'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/group/create', express.json(), async (req, res) => {
  const { groupName, groupSecret, privacy, uuid } = req.body;

  if (!groupName) {
    return res.status(400).json({
      error: 'Group name is required in JSON body',
      example: { groupName: 'mygroup', groupSecret: 'mysecret' }
    });
  }
  if (!groupSecret) {
    return res.status(400).json({
      error: 'Group secret is required in JSON body',
      example: { groupName: 'mygroup', groupSecret: 'mysecret' }
    });
  }
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
    const prompt = `Is the group name "${groupName} ${groupSecret}" appropriate? Return "yes" if it is appropriate, otherwise return "no". Do not include any additional text or explanations.`;

    const response = await model.generateContent(prompt);

    const isAppropriate = response.response.text().trim().toLowerCase() === 'yes';

    if (!isAppropriate) {
      return res.json({
        success: false,
        message: 'The data is not appropriate. Please try again.',
        groupName: groupName
      });
    }

    const accountDocRef = doc(db, 'accounts', uuid);
    const accountDoc = await getDoc(accountDocRef);

    if (!accountDoc.exists()) {
      return res.status(404).json({
        error: 'User not registered. Please register first.',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const username = accountData.username;

    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);

    if (groupDoc.exists()) {
      return res.json({
        success: false,
        message: 'The group name is taken. Please choose a different name.',
        groupName: groupName
      });
    }

    await setDoc(docRef, {
      members: [username],
      secret: groupSecret,
      privacy: privacy || false
    });

    const userDocRef = doc(db, 'users', username);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      await setDoc(userDocRef, { groups: [groupName], owned: [groupName] });
    } else {
      const userData = userDoc.data();
      const groups = userData?.groups || [];
      const owned = userData?.owned || [];
      groups.push(groupName);
      owned.push(groupName);
      await updateDoc(userDocRef, { groups, owned });
    }

    return res.json({
      success: true,
      message: 'Group created successfully',
      groupName: groupName,
      username: username,
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/group/delete', express.json(), async (req, res) => {
  const { groupName, uuid } = req.body;
  if (!groupName || !uuid) {
    return res.status(400).json({
      error: 'Group name and UUID is required in JSON body',
      example: { groupName: 'mygroup', uuid: 'your-uuid' }
    });
  }
  try {
    const accountDocRef = doc(db, 'accounts', uuid);
    const accountDoc = await getDoc(accountDocRef);

    if (!accountDoc.exists()) {
      return res.status(404).json({
        error: 'User not registered. Please register first.',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const username = accountData.username;

    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);

    if (!groupDoc.exists()) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }

    const groupData = groupDoc.data();
    const members = groupData?.members || [];

    const userDocRef = doc(db, 'users', username);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      return res.status(404).json({
        error: 'User not found',
        username: username
      });
    }

    const userData = userDoc.data();
    const prevOwned = userData?.owned || [];

    const owned = prevOwned.filter((g: string) => g !== groupName);
    await updateDoc(userDocRef, { owned });

    for (const member of members) {
      const memberDocRef = doc(db, 'users', member);
      const memberDoc = await getDoc(memberDocRef);

      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        const memberGroups = memberData?.groups || [];
        const updatedGroups = memberGroups.filter((g: string) => g !== groupName);
        await updateDoc(memberDocRef, { groups: updatedGroups });
      }
    }
    await deleteDoc(docRef);
    
    return res.json({
      success: true,
      message: 'User removed from group successfully',
      username: username,
      groupName: groupName,
    });
    
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});


app.get('/user/status/:uuid', express.json(), async (req, res) => {
  const { uuid } = req.params;

  if (!uuid) {
    return res.status(400).json({
      error: 'Uid is required'
    });
  }

  try {
    const docRef = doc(db, 'accounts', uuid);
    const userDoc = await getDoc(docRef);
    return res.status(200).json({
      found : userDoc.exists(),
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.get('/user/profile/:uuid', express.json(), async (req, res) => {
  const { uuid } = req.params;
  if (!uuid) {
    return res.status(400).json({
      error: 'UUID is required'
    });
  }
  try {
    const accountDocRefdocRef = doc(db, 'accounts', uuid);
    const accountDoc = await getDoc(accountDocRefdocRef);
    if (!accountDoc.exists()) {
      return res.status(404).json({
        error: 'User not found',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const userDocRef = doc(db, 'users', accountData.username);
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
      await setDoc(userDocRef, { groups: [], owned: [] });
    }
    const userData = userDoc.data();
    const userSubmissionStats = await queryLeetCodeAPI(userSubmissionsQuery, { username: accountData.username });

    let ownedGroups: Array<[string, any]> = [];
    if (Array.isArray(userData.owned)) {
      ownedGroups = await Promise.all(
      userData.owned.map(async (groupName: string) => {
        try {
        const groupDocRef = doc(db, 'groups', groupName);
        const groupDoc = await getDoc(groupDocRef);
        return [groupName, groupDoc.exists() ? groupDoc.data() : null];
        } catch (e) {
        return [groupName, null];
        }
      })
      );
    }
    return res.json({
      username: accountData.username,
      userAvatar: accountData.userAvatar,
      groups: userData.groups || [],
      owned: ownedGroups,
      total: userSubmissionStats.data.matchedUser.submitStats.acSubmissionNum[0].count,
      easy: userSubmissionStats.data.matchedUser.submitStats.acSubmissionNum[1].count,
      medium: userSubmissionStats.data.matchedUser.submitStats.acSubmissionNum[2].count,
      hard: userSubmissionStats.data.matchedUser.submitStats.acSubmissionNum[3].count,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/user/register', express.json(), async (req, res) => {
  const { uuid, username } = req.body;
  if (!uuid || !username) {
    return res.status(400).json({
      error: 'UUID and username are required'
    });
  }
  try {
    const docRef = doc(db, 'accounts', uuid);
    const userDoc = await getDoc(docRef);
    if (userDoc.exists()) {
      return res.status(409).json({
        error: 'User already Linked',
        uuid: uuid
      });
    }
    const userStatus = await queryLeetCodeAPI(userStatusQuery, { username });
    const status = userStatus.data.matchedUser.profile.aboutMe || '';
    const userAvatar = userStatus.data.matchedUser.profile.userAvatar || '';

    if (!status.includes(uuid)) {
      return res.status(403).json({
        error: 'Please add uuid to your LeetCode profile status/about section',
        username: username,
        currentStatus: status
      });
    }
    await setDoc(docRef, { username, userAvatar });

    return res.json({
      message: 'User registered successfully',
      username: username,
      userAvatar: userAvatar,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/group/change-privacy', express.json(), async (req, res) => {
  const { groupName, privacy } = req.body;
  if (!groupName || privacy === null || privacy === undefined) {
    return res.status(400).json({
      error: 'Group name and privacy are required',
      example: { groupName: 'mygroup', privacy: 'public' }
    });
  }
  try {
    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);

    if (!groupDoc.exists()) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }

    await updateDoc(docRef, { privacy });

    return res.json({
      success: true,
      message: 'Group privacy updated successfully',
      groupName: groupName,
      newPrivacy: privacy
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/group/change-secret', express.json(), async (req, res) => {
  const { groupName, newSecret } = req.body;
  if (!groupName || !newSecret) {
    return res.status(400).json({
      error: 'Group name and new secret are required',
      example: { groupName: 'mygroup', newSecret: 'newsecret' }
    });
  }
  try {
    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);
    if (!groupDoc.exists()) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }
    const groupData = groupDoc.data();
    if (!groupData.secret) {
      return res.status(400).json({
        error: 'Group secret is not set',
        groupName: groupName
      });
    }
    await updateDoc(docRef, { secret: newSecret });
    return res.json({
      success: true,
      message: 'Group secret updated successfully',
      groupName: groupName,
      newSecret: newSecret
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

async function userGroupHandler(username: string, groupName: string) {
  const docRef = doc(db, 'users', username);
  const userDoc = await getDoc(docRef);
  if (!userDoc.exists()) {
    await setDoc(docRef, { groups: [groupName], owned: [] });
  } else {
    const userData = userDoc.data();
    const groups = userData?.groups || [];
    if (!groups.includes(groupName)) {
      groups.push(groupName);
      await updateDoc(docRef, { groups });
    }
  }
}

export default app;
