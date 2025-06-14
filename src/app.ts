import express, {Response, NextFunction} from 'express';
import cors from 'cors';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import {
  userStatusQuery,
  userSubmissionsQuery,
} from './GQLQueries/newQueries';
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const API_URL = process.env.LEETCODE_API_URL || 'https://leetcode.com/graphql';

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later.',
  },
});

app.use(limiter);
app.listen(3000, '127.0.0.1', () => {
  console.log('Server running on http://127.0.0.1:3000');
});
app.use(cors());
app.use((req: express.Request, _res: Response, next: NextFunction) => {
  const origin = req.get('Origin');
  if (
    origin &&
    !origin.includes('leeterboard.xyz') &&
    !origin.includes('leeterboard.nakulkamath.tech')
  ) {
    return _res.status(403).json({ error: 'Access denied' });
  }

  console.log('Requested URL:', req.originalUrl);
  return next();
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
      throw new Error(`Error in setting up the request: ${error.message}`);
    }
  }
}

require('dotenv').config();

const admin = require('firebase-admin');
if (!process.env.FIREBASE_CONFIG_JSON) {
  throw new Error('FIREBASE_CONFIG_JSON environment variable is not set');
}
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Root endpoint
app.get('/', (_req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});


app.get('/group/fetch/:group/:uuid/:code', express.json(), async (req, res) => {
  const groupName = req.params.group;
  const uuid = req.params.uuid;
  const code = req.params.code;

  if (!groupName) {
    return res.json({
      success: false,
      message: 'Group name is required in JSON body',
      example: { groupName: 'mygroup' },
      prompt: false
    });
  }

  try {
    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();
    
    if (!groupDoc.data()) {
      return res.json({
        success: false,
        message: 'Group does not exist, or was deleted.',
        groupName: groupName,
        prompt: false
      });
    }

    const groupData = groupDoc.data();
    const members = groupData?.members || [];
    const privacy = groupData?.privacy;
    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const accountDoc = await accountDocRef.get();

    let username = null;
    if (accountDoc.exists) {
      const accountData = accountDoc.data();
      username = accountData.username;
    }

    if (privacy && privacy === true && code !== groupData.secret && !(uuid !== "none" && uuid.startsWith('anon-') && members.includes(uuid.slice(5)))) {
      if (!accountDoc.exists) {
        return res.json({
          success: false,
          message: 'Group is private. Please ask for an invite.',
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
            message: 'You are not a member of this group. Please ask for an invite.',
            username: user,
            groupName: groupName
          });
        }
      }
    }

    const userPromises = members.map(async (username: string) => {
      try {
        const userData = await queryLeetCodeAPI(userSubmissionsQuery, { username });
        
        if (userData === undefined || userData.errors) {
          return {
            username: username,
            questionsSolved: null,
            error: 'User not found on LeetCode'
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
      prompt: ((username !== null && !members.includes(username)) || username === null && uuid === 'none' || uuid.startsWith('anon-') && !members.includes(uuid.slice(5))) && code === groupData.secret,
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
    return res.json({
      success: false,
      message: 'All fields are required',
      example: { username: 'john', groupName: 'mygroup' }
    });
  }

  try {

    const userData = await queryLeetCodeAPI(userStatusQuery, { username : username.slice(5) });

    if (userData === undefined || userData.errors) {
      return res.json({
        success: false,
        message: 'User not found on LeetCode',
        username: username.slice(5)
      });
    }

    const userStatus = userData.data.matchedUser.profile.aboutMe || '';

    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();

    if (!groupDoc.data()) {
      return res.json({
        success: false,
        message: 'Group not found',
        groupName: groupName
      });
    }

    if (secret != groupDoc.data()?.secret) {
      return res.json({
        success: false,
        message: 'Invalid group secret',
        groupName: groupName
      });
    }

    const groupData = groupDoc.data();
    const groupSecret = groupData?.secret;
    const currentMembers = groupData?.members || [];

    if (currentMembers.includes(username.slice(5))) {
      return res.json({
        success: true,
        message: 'User is already a member of this group',
        username: username.slice(5),
        groupName: groupName
      });
    }

    if (!userStatus.includes(groupSecret)) {
      return res.json({
        success: false,
        message: `Please add "${groupSecret}" to your LeetCode profile status/about section`,
        username: username.slice(5),
        currentStatus: userStatus
      });
    }

    const updatedMembers = [...currentMembers, username.slice(5)];

    await groupDocRef.update({
      members: updatedMembers
    });

    await userGroupHandler(username.slice(5), groupName);

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
    return res.json({
      success: false,
      message: 'All fields are required',
    });
  }

  try {
    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const accountDoc = await accountDocRef.get();
    if (!accountDoc.exists) {
      return res.json({
        success: false,
        message: 'Your account not linked. Please head to dashboard and link your account first.',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const username = accountData.username;

    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();

    if (!groupDoc.data()) {
      return res.json({
        success: false,
        message: 'Group not found',
        groupName: groupName
      });
    }

    if (secret != groupDoc.data()?.secret) {
      return res.json({
        success: false,
        message: 'Invalid group secret/group secret has changed',
        groupName: groupName
      });
    }

    const groupData = groupDoc.data();
    const currentMembers = groupData?.members || [];

    if (currentMembers.includes(username)) {
      return res.json({
        success: true,
        message: 'User is already a member of this group',
        username: username,
        groupName: groupName
      });
    }

    const updatedMembers = [...currentMembers, username];

    await groupDocRef.update({
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

app.post('/user/remove', express.json(), async (req, res) => {
  const { uuid, groupName } = req.body;
  let username = req.body.username;
  if (username && username.startsWith('anon-')) {
    username = username.slice(5);
  }
  if (!groupName || !uuid && !username) {
    return res.json({
      success: false,
      message: 'Group name and UUID or username are required',
      example: { groupName: 'mygroup', uuid: 'your-uuid', username: 'john' }
    });
  }
  try {
    if (uuid) {
      const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
      const accountDoc = await accountDocRef.get();

      if (!accountDoc.exists) {
        return res.json({
          success: false,
          message: 'User not registered. Please register first.',
          uuid: uuid
        });
      }
      const accountData = accountDoc.data();
      username = accountData.username;
    }
      const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
      const groupDoc = await groupDocRef.get();
      const userDocRef = db.collection('users').doc(username.replace(/\s+/g, ' ').trim());
      const userDoc = await userDocRef.get();
      if (!groupDoc.exists) {
        return res.json({
          success: false,
          message: 'Group not found',
          groupName: groupName
        });
      }
      if (!userDoc.exists) {
        return res.json({
          success: false,
          message: 'User not found',
          username: username
        });
      }
      const groupData = groupDoc.data();
      const userData = userDoc.data();
      if (userData.owned.includes(groupName)) {
        return res.json({
          success: false,
          message: 'You cannot remove yourself from a group you own. Please delete the group instead.',
          username: username,
          groupName: groupName
        })
      }
      const members = groupData?.members || [];
      if (!members.includes(username)) {
        return res.json({
          success: false,
          message: 'User is not a member of this group',
          username: username,
          groupName: groupName
        });
      }
      const updatedMembers = members.filter((member: string) => member !== username);
      await groupDocRef.update({
        members: updatedMembers
      });
      const userGroups = userData?.groups || [];
      const updatedGroups = userGroups.filter((group: string) => group !== groupName);
      await userDocRef.update({
        groups: updatedGroups
      });
      return res.json({
        success: true,
        message: 'User removed from group successfully',
        groupName: groupName,
        username: username
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
    return res.json({
      success: false,
      message: 'Group name is required.',
      example: { groupName: 'mygroup', groupSecret: 'mysecret' }
    });
  }
  if (!groupSecret) {
    return res.json({
      success: false,
      message: 'Group secret is required.',
      example: { groupName: 'mygroup', groupSecret: 'mysecret' }
    });
  }
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
    const prompt = `Are the words/sentences "${groupName}" and "${groupSecret}" appropriate? Return "yes" if it is appropriate, otherwise return "no". Do not include any additional text or explanations.`;

    const response = await model.generateContent(prompt);

    const isAppropriate = response.response.text().trim().toLowerCase() === 'yes';

    if (!isAppropriate) {
      return res.json({
        success: false,
        message: 'The data is not appropriate. Please try again.',
        groupName: groupName
      });
    }

    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const accountDoc = await accountDocRef.get();

    if (!accountDoc.exists) {
      return res.json({
        success: false,
        message: 'Account is not linked with leetcode profile.',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const username = accountData.username;

    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();

    if (groupDoc.exists) {
      return res.json({
        success: false,
        message: 'The group name is taken. Please choose a different name.',
        groupName: groupName
      });
    }

    await groupDocRef.set({
      members: [username],
      secret: groupSecret.trim(),
      privacy: privacy || false
    });

    const userDocRef = db.collection('users').doc(username.replace(/\s+/g, ' ').trim());
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      await userDocRef.set({ 
        groups: [groupName.replace(/\s+/g, ' ').trim()], 
        owned: [groupName.replace(/\s+/g, ' ').trim()] 
      });
    } else {
      const userData = userDoc.data();
      const groups = userData?.groups || [];
      const owned = userData?.owned || [];
      groups.push(groupName);
      owned.push(groupName);
      await userDocRef.update({ groups, owned });
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
    return res.json({
      success: false,
      message: 'Group name and UUID is required in JSON body',
      example: { groupName: 'mygroup', uuid: 'your-uuid' }
    });
  }
  try {
    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const accountDoc = await accountDocRef.get();

    if (!accountDoc.exists) {
      return res.json({
        success: false,
        message: 'User not registered. Please register first.',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const username = accountData.username;

    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();

    if (!groupDoc.exists) {
      return res.json({
        success: false,
        message: 'Group not found/please stop spamming',
        groupName: groupName
      });
    }

    const groupData = groupDoc.data();
    const members = groupData?.members || [];

    const userDocRef = db.collection('users').doc(username.replace(/\s+/g, ' ').trim());
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.json({
        success: false,
        message: 'User not found',
        username: username
      });
    }

    const userData = userDoc.data();
    const prevOwned = userData?.owned || [];

    const owned = prevOwned.filter((g: string) => g !== groupName);
    await userDocRef.update({ owned });

    for (const member of members) {
      const memberDocRef = db.collection('users').doc(member.replace(/\s+/g, ' ').trim());
      const memberDoc = await memberDocRef.get();

      if (memberDoc.exists) {
        const memberData = memberDoc.data();
        const memberGroups = memberData?.groups || [];
        const updatedGroups = memberGroups.filter((g: string) => g !== groupName);
        await memberDocRef.update({ groups: updatedGroups });
      }
    }
    await groupDocRef.delete();
    
    return res.json({
      success: true,
      message: 'User removed from group successfully',
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
    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const userDoc = await accountDocRef.get();
    return res.status(200).json({
      found : userDoc.exists,
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
    return res.json({
      success: false,
      message: 'UUID is required'
    });
  }
  try {
    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const accountDoc = await accountDocRef.get();

    if (!accountDoc.exists) {
      return res.json({
        success: false,
        message: 'User not found',
        uuid: uuid
      });
    }
    const accountData = accountDoc.data();
    const userDocRef = db.collection('users').doc(accountData.username.replace(/\s+/g, ' ').trim());
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      await userDocRef.set({ groups: [], owned: [] });
    }
    const userData = userDoc.data();
    const userSubmissionStats = await queryLeetCodeAPI(userSubmissionsQuery, { username: accountData.username });

    let ownedGroups: Array<[string, any]> = [];
    if (Array.isArray(userData.owned)) {
      ownedGroups = await Promise.all(
      userData.owned.map(async (groupName: string) => {
        try {
        const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
        const groupDoc = await groupDocRef.get();
        return [groupName, groupDoc.exists ? groupDoc.data() : null];
        } catch (e) {
        return [groupName, null];
        }
      })
      );
    }
    return res.json({
      success: true,
      message: 'User profile fetched successfully',
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
    const accountDocRef = db.collection('accounts').doc(uuid.replace(/\s+/g, ' ').trim());
    const userDoc = await accountDocRef.get();
    if (userDoc.exists) {
      return res.json({
        success: false,
        message: 'User already Linked',
        uuid: uuid
      });
    }
    
    const userStatus = await queryLeetCodeAPI(userStatusQuery, { username: username });
    if (userStatus === undefined) {
      return res.json({
        success: false,
        message: 'User not found on LeetCode',
        username: username
      });
    }
    const status = userStatus.data.matchedUser.profile.aboutMe || '';
    const userAvatar = userStatus.data.matchedUser.profile.userAvatar || '';

    if (!status.includes(uuid)) {
      return res.json({
        success: false,
        message: 'Please add the code to your LeetCode profile status/about section and try again.',
        username: username,
        currentStatus: status
      });
    }
    await accountDocRef.set({ username: username.replace(/\s+/g, ' ').trim(), userAvatar: userAvatar.replace(/\s+/g, ' ').trim() });

    return res.json({
      success: true,
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
    return res.json({
      success: false,
      message: 'Group name and privacy are required',
      example: { groupName: 'mygroup', privacy: 'public' }
    });
  }
  try {
    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();

    if (!groupDoc.exists) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }

    await groupDocRef.update({ privacy });

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
    return res.json({
      success: false,
      message: 'Group name and new secret are required',
      example: { groupName: 'mygroup', newSecret: 'newsecret' }
    });
  }
  try {
    const groupDocRef = db.collection('groups').doc(groupName.replace(/\s+/g, ' ').trim());
    const groupDoc = await groupDocRef.get();
    if (!groupDoc.exists) {
      return res.json({
        success: false,
        message: 'Group not found',
        groupName: groupName
      });
    }
    await groupDocRef.update({ secret: newSecret });
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
  const userDocRef = db.collection('users').doc(username.replace(/\s+/g, ' ').trim());
  const userDoc = await userDocRef.get();
  if (!userDoc.exists) {
    await userDocRef.set({ groups: [groupName.replace(/\s+/g, ' ').trim()], owned: [] });
  } else {
    const userData = userDoc.data();
    const groups = userData?.groups || [];
    if (!groups.includes(groupName)) {
      groups.push(groupName);
      await userDocRef.update({ groups });
    }
  }
}

export default app;
