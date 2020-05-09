'use strict';
const express = require('express');
const router = express.Router();
const authenticationEnsurer = require('./authentication-ensurer');
const uuid = require('uuid');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
const User = require('../models/user');
const Availablity = require('../models/availability');
const Comment = require('../models/comment');

router.get('/new', authenticationEnsurer, (req, res, next) => {
  res.render('new', { user: req.user });
});

router.post('/', authenticationEnsurer, (req, res, next) => {
  const scheduleId = uuid.v4();
  const updatedAt = new Date();
  Schedule.create({
    scheduleId: scheduleId,
    scheduleName: req.body.scheduleName.slice(0.255) || '（名称未設定）',
    memo: req.body.memo,
    createdBy: req.user.id,
    updatedAt: updatedAt
  }).then((schedule) => {
    const candidateNames = req.body.candidates.trim().split('\n').map((s) => s.trim()).filter((s) => s !=="");
    const candidates = candidateNames.map((c) => {return {
      candidateName: c,
      scheduleId: schedule.scheduleId
    };});
    Candidate.bulkCreate(candidates).then(() => {
      res.redirect('/schedules' + schedule.scheduleId);
    });
  });
});

router.get('/:scheduleId', authenticationEnsurer, (req, res, next) => {
  Schedule.findOne({
    include: [
      {
        model: User,
        attributes: ['userId', 'username']
      }],
    where: {
      scheduleId: req.params.scheduleId
    },
    order: [['updatedAt', 'DESC']]
  }).then((schedule) => {
    if (schedule) {
      Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['candidateId', 'ASC']]
      }).then((candidates) => {
        //データベースから、その予定のすべての出欠を取得する
        Availablity.findAll({
          include: [
            {
              model: User,
              attributes: ['userId', 'username']
            }
          ],
          where: { scheduleId: schedule.scheduleId},
          order: [[User, 'username', 'ASC'],['candidateId', 'ASC']]
        }).then((availablitys) => { //上記の非同期処理が終わったら、引数availablitysを受け取る無名関数を登録
          // 出欠 MapMap(キー:ユーザーID, 値:出欠Map(キー:候補ID, 値:出欠))　を作成する
          const availabilityMapMap = new Map(); // key: userId, value: Map(Key: candidateId, value: availablitys)
          availablitys.forEach( (a)=> {
            const map = availabilityMapMap.get(a.user.userId) || new Map();
            map.set(a.CandidateId, a.Availablity);
            availabilityMapMap.set(a.user.userId, map);
          });

          //閲覧ユーザーと出欠に紐づくユーザーからユーザーMap(key:ユーザーID, Value:ユーザー) を作る
          const userMap = new Map(); // key: userId, value: User
          userMap.set(parseInt(req.user.id), {
            isSelf: true,
            userId: parseInt(req.user.id),
            username: req.user.username
          });
          availablitys.forEach((a) => {
            userMap.set(a.user.userId, {
              isSelf: parseInt(req.user.id) === a.user.userId, //閲覧ユーザー自身であるかを含める
              userId: a.user.userId,
              username: a.user.username
            });
          });

          //全ユーザー,全候補で二重ループしてそれぞれの出欠の値が無い場合には、「欠席」を設定する
          const users = Array.from(userMap).map((keyValue) => keyValue[1]);
          users.forEach((u) => {
            candidates.forEach((c) => {
              const map = availabilityMapMap.get(u.userId) || new Map();
              const a = map.get(c.candidateId) || 0; //デフォルト値は0を利用
              map.set(c.candidateId, a);
              availabilityMapMap.set(u.userId, map);
            });
          });
          
          // コメント取得
          Comment.findAll({
            where: { scheduleId: schedule.scheduleId }
          }).then((comments) => {
            const commentMap = new Map();  // key: userId, value: comment
            comments.forEach((comment) => {
              commentMap.set(comment.userId, comment.comment);
            });
            res.render('schedule', {
              user: req.user,
              schedule: schedule,
              candidates: candidates,
              users: users,
              availabilityMapMap: availabilityMapMap,
              commentMap: commentMap
            });            
          });
        });
      });
    } else {
      const err = new Error('指定された予定は見つかりません');
      err.status = 404;
      next(err);
    }
  });
});

router.get('/:scheduleId/edit', authenticationEnsurer, (req, res, next) => {
  Schedule.findOne({
    where: {
      scheduleId: req.params.scheduleId
    }
  }).then((schedule) => {
    if (isMine(req, schedule)) { // 作成者のみが編集フォームを開ける
      Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['candidateId', 'ASC']]
      }).then((candidates) => {
        res.render('edit', {
          user: req.user,
          schedule: schedule,
          candidates: candidates
        });
      });
    } else {
      const err = new Error('指定された予定がない、または、予定する権限がありません');
      err.status = 404;
      next(err);
    }
  });
});
  
function isMine(req, schedule) {
  return schedule && parseInt(schedule.createdBy) === parseInt(req.user.id);
}
  

module.exports = router;