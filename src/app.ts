import express, { NextFunction, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as leetcode from './leetCode';
import { FetchUserDataRequest } from './types';
import axios from 'axios';
import {
  userContestRankingInfoQuery,
  discussCommentsQuery,
  discussTopicQuery,
  userProfileUserQuestionProgressV2Query,
  skillStatsQuery,
  getUserProfileQuery,
  userProfileCalendarQuery,
  officialSolutionQuery,
  dailyQeustion,
} from './GQLQueries/newQueries';
import query from './GQLQueries/userProfile';

const app = express();
const API_URL = process.env.LEETCODE_API_URL || 'https://leetcode.com/graphql';

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many request from this IP, try again in 1 hour',
});

app.use(cors()); //enable all CORS request
app.use(limiter); //limit to all API
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

app.get('/', (_req, res) => {
  res.json({
    apiOverview:
      'Welcome to the Alfa-Leetcode-API! Alfa-Leetcode-Api is a custom solution born out of the need for a well-documented and detailed LeetCode API. This project is designed to provide developers with endpoints that offer insights into a user"s profile, badges, solved questions, contest details, contest history, submissions, and also daily questions, selected problem, list of problems.',
    apiEndpointsLink:
      'https://github.com/alfaarghya/alfa-leetcode-api?tab=readme-ov-file#endpoints-',
    routes: {
      userDetails: {
        description:
          'Endpoints for retrieving detailed user profile information on Leetcode.',
        Method: 'GET',
        '/:username': 'Get your leetcodevis profile Details',
        '/:username/badges': 'Get your badges',
        '/:username/solved': 'Get total number of question you solved',
        '/:username/contest': 'Get your contest details',
        '/:username/contest/history': 'Get all contest history',
        '/:username/submission': 'Get your last 20 submission',
        '/:username/acSubmission': 'Get your last 20 accepted submission',
        '/:username/calendar': 'Get your submission calendar',
        '/userProfile/:username': 'Get full profile details in one call',
        '/userProfileCalendar?username=yourname&year=2024':
          'Get your calendar details with year',
        '/languageStats?username=yourname': 'Get the language stats of a user',
        '/userProfileUserQuestionProgressV2/:userSlug':
          'Get your question progress',
        '/skillStats/:username': 'Get your skill stats',
      },
      contest: {
        description:
          'Endpoints for retrieving contest ranking and performance data.',
        Method: 'GET',
        '/userContestRankingInfo/:username': 'Get user contest ranking info',
      },
      discussion: {
        description: 'Endpoints for fetching discussion topics and comments.',
        Method: 'GET',
        '/trendingDiscuss?first=20': 'Get top 20 trending discussions',
        '/discussTopic/:topicId': 'Get discussion topic',
        '/discussComments/:topicId': 'Get discussion comments',
      },
      problems: {
        description:
          'Endpoints for fetching problem-related data, including lists, details, and solutions.',
        Method: 'GET',
        singleProblem: {
          '/select?titleSlug=two-sum': 'Get selected Problem',
          '/daily': 'Get daily Problem',
          '/dailyQuestion': 'Get raw daily question',
        },
        problemList: {
          '/problems': 'Get list of 20 problems',
          '/problems?limit=50': 'Get list of some problems',
          '/problems?tags=array+math': 'Get list problems on selected topics',
          '/problems?tags=array+math+string&limit=5':
            'Get list some problems on selected topics',
          '/officialSolution?titleSlug=two-sum':
            'Get official solution of selected problem',
        },
      },
    },
  });
});

app.get('/officialSolution', async (req, res) => {
  const { titleSlug } = req.query;

  if (!titleSlug) {
    return res.status(400).json({ error: 'Missing titleSlug query parameter' });
  }
  try {
    const data = await queryLeetCodeAPI(officialSolutionQuery, { titleSlug });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/userProfileCalendar', async (req, res) => {
  const { username, year } = req.query;

  if (!username || !year || typeof year !== 'string') {
    return res
      .status(400)
      .json({ error: 'Missing or invalid username or year query parameter' });
  }

  try {
    const data = await queryLeetCodeAPI(userProfileCalendarQuery, {
      username,
      year: parseInt(year),
    });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Format data
const formatData = (data: any) => {
  return {
    totalSolved: data.matchedUser.submitStats.acSubmissionNum[0].count,
    totalSubmissions: data.matchedUser.submitStats.totalSubmissionNum,
    totalQuestions: data.allQuestionsCount[0].count,
    easySolved: data.matchedUser.submitStats.acSubmissionNum[1].count,
    totalEasy: data.allQuestionsCount[1].count,
    mediumSolved: data.matchedUser.submitStats.acSubmissionNum[2].count,
    totalMedium: data.allQuestionsCount[2].count,
    hardSolved: data.matchedUser.submitStats.acSubmissionNum[3].count,
    totalHard: data.allQuestionsCount[3].count,
    ranking: data.matchedUser.profile.ranking,
    contributionPoint: data.matchedUser.contributions.points,
    reputation: data.matchedUser.profile.reputation,
    submissionCalendar: JSON.parse(data.matchedUser.submissionCalendar),
    recentSubmissions: data.recentSubmissionList,
    matchedUserStats: data.matchedUser.submitStats,
  };
};

app.get('/userProfile/:id', async (req, res) => {
  const user = req.params.id;

  try {
    const data = await queryLeetCodeAPI(getUserProfileQuery, {
      username: user,
    });
    if (data.errors) {
      res.send(data);
    } else {
      res.send(formatData(data.data));
    }
  } catch (error) {
    res.send(error);
  }
});

const handleRequest = async (res: Response, query: string, params: any) => {
  try {
    const data = await queryLeetCodeAPI(query, params);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
app.get('/dailyQuestion', (_, res) => {
  handleRequest(res, dailyQeustion, {});
});

app.get('/skillStats/:username', (req, res) => {
  const { username } = req.params;
  handleRequest(res, skillStatsQuery, { username });
});

app.get('/userProfileUserQuestionProgressV2/:userSlug', (req, res) => {
  const { userSlug } = req.params;
  handleRequest(res, userProfileUserQuestionProgressV2Query, { userSlug });
});

app.get('/discussTopic/:topicId', (req, res) => {
  const topicId = parseInt(req.params.topicId);
  handleRequest(res, discussTopicQuery, { topicId });
});

app.get('/discussComments/:topicId', (req, res) => {
  const topicId = parseInt(req.params.topicId);
  const {
    orderBy = 'newest_to_oldest',
    pageNo = 1,
    numPerPage = 10,
  } = req.query;
  handleRequest(res, discussCommentsQuery, {
    topicId,
    orderBy,
    pageNo,
    numPerPage,
  });
});

app.get('/userContestRankingInfo/:username', (req, res) => {
  const { username } = req.params;
  handleRequest(res, userContestRankingInfoQuery, { username });
});

//get the daily leetCode problem
app.get('/daily', leetcode.dailyProblem);

//get the selected question
app.get('/select', leetcode.selectProblem);

//get list of problems
app.get('/problems', leetcode.problems);

//get 20 trending Discuss
app.get('/trendingDiscuss', leetcode.trendingCategoryTopics);

app.get('/languageStats', leetcode.languageStats);

// Construct options object on all user routes.
app.use(
  '/:username*',
  (req: FetchUserDataRequest, _res: Response, next: NextFunction) => {
    req.body = {
      username: req.params.username,
      limit: req.query.limit,
    };
    next();
  }
);

//get user profile details
app.get('/user/:username', leetcode.userData);
app.get('/user/:username/badges', leetcode.userBadges);
app.get('/user/:username/solved', leetcode.solvedProblem);
app.get('/user/:username/contest', leetcode.userContest);
app.get('/user/:username/contest/history', leetcode.userContestHistory);
app.get('/user/:username/submission', leetcode.submission);
app.get('/user/:username/acSubmission', leetcode.acSubmission);
app.get('/user/:username/calendar', leetcode.calendar);

const {initializeApp} = require('firebase/app');
const { 
  getFirestore, 
  getDoc,
  doc,
  updateDoc,
  setDoc,
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

app.get('/group/fetch', express.json(), async (req, res) => {
  const { groupName } = req.body;
  
  if (!groupName) {
    return res.status(400).json({
      error: 'Group name is required in JSON body',
      example: { groupName: 'mygroup' }
    });
  }

  try {
    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);
    
    if (!groupDoc.data()) {
      return res.status(404).json({
        error: 'Group not found',
        groupName: groupName
      });
    }
    
    const groupData = groupDoc.data();
    const members = groupData?.members;
    
    if (!members || !Array.isArray(members)) {
      return res.status(400).json({
        error: 'No members found in group or invalid members format',
        groupName: groupName
      });
    }
    const userPromises = members.map(async (username: string) => {
      try {
        const userData = await queryLeetCodeAPI(query, { username });
        
        if (userData.errors) {
          return {
            username: username,
            questionsSolved: null,
            error: 'User not found'
          };
        }
        
        const questionsSolved = userData.data.matchedUser.submitStats.acSubmissionNum[0].count;
        const easySolved = userData.data.matchedUser.submitStats.acSubmissionNum[1].count;
        const mediumSolved = userData.data.matchedUser.submitStats.acSubmissionNum[2].count;
        const hardSolved = userData.data.matchedUser.submitStats.acSubmissionNum[3].count;
        const avatar = userData.data.matchedUser.profile.userAvatar || '';
        
        return {
          username: username,
          avatar: avatar,
          questionsSolved: questionsSolved,
          easy: easySolved,
          medium: mediumSolved,
          hard: hardSolved,
          points: easySolved + mediumSolved * 2 + hardSolved * 3,
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
      if (a.questionsSolved === null) return 1;
      if (b.questionsSolved === null) return -1;
      return b.questionsSolved - a.questionsSolved;
    });
    
    return res.json({
      groupName: groupName,
      totalMembers: members.length,
      members: sortedUsers
    });
    
  } catch (error) {
    console.error('Error fetching group data:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/group/add', express.json(), async (req, res) => {
  const { username, groupName } = req.body;

  if (!groupName) {
    return res.status(400).json({
      error: 'Group name is required',
      example: { username: 'john', groupName: 'mygroup' }
    });
  }
  if (!username) {
    return res.status(400).json({
      error: 'Username is required',
      example: { username: 'john', groupName: 'mygroup' }
    });
  }

  try {
    const userData = await queryLeetCodeAPI(query, { username });

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

    const groupData = groupDoc.data();
    const groupSecret = groupData?.secret;
    const currentMembers = groupData?.members || [];

    if (!groupSecret) {
      return res.status(500).json({
        error: 'Group secret not configured',
        groupName: groupName
      });
    }

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
      message: 'User successfully added to group',
      username: username,
      groupName: groupName,
      totalMembers: updatedMembers.length,
      newMembersList: updatedMembers
    });

  } catch (error) {
    console.error('Error adding user to group:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/group/create', express.json(), async (req, res) => {
  const { groupName, groupSecret } = req.body;

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
    const docRef = doc(db, 'groups', groupName);
    const groupDoc = await getDoc(docRef);

    if (groupDoc.exists()) {
      return res.status(409).json({
        error: 'Group already exists',
        groupName: groupName
      });
    }

    await setDoc(docRef, {
      members: [],
      secret: groupSecret,
    });

    return res.json({
      success: true,
      message: 'Group created successfully',
      groupName: groupName
    });

  } catch (error) {
    console.error('Error creating group:', error);
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
    await setDoc(docRef, { groups: [groupName] });
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
