<h1 align="center">leeterboard-backend</h1>
<div align="center">

![TypeScript](https://img.shields.io/badge/typetscript-%2320232a.svg?style=for-the-badge&logo=typescript&logoColor=%fff)
![Node.js](https://img.shields.io/badge/Node.js-%2320232a?style=for-the-badge&logo=node.js&logoColor=43853D)
![Express.js](https://img.shields.io/badge/express-%2320232a.svg?style=for-the-badge&logo=express&logoColor=%23F7DF1E)
![REST API](https://img.shields.io/badge/RestApi-%2320232a.svg?style=for-the-badge&logo=restAPI&logoColor=%23F7DF1E)

</div>

## About ✨

Uses alfa's leetcode-api as a baseline framework, and overhauls it with features adding firebase authentication, firestore and leetcode's graphQL api queries to support the frontend of leeterboard.xyz


## API URL 🌐

```
https://api.leeterboard.xyz/
```

## Run with docker 🐳

```
docker run -p 3000:3000 leeterboard/leeterboard-api:0.2.4
```

### 💡 Rate Limit

I've implemented a rate limit to prevent any potential server overload issues.

### ‼️ Note

During development, it's recommended to utilize the API locally. To do so, follow this documentation => <a href="CONTRIBUTING.md" target="_blank">Local Deploy</a>
