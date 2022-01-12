const express = require('express');
const useController = require('../controllers/userController');
const { signup, login } = require('../controllers/authController');

const router = express.Router();

router.post('/signup', signup);

router.post('/login', login);

router.route('/').get(useController.getAllUsers).post(useController.createUser);

router
  .route('/:id')
  .get(useController.getUser)
  .patch(useController.updateUser)
  .delete(useController.deleteUser);

module.exports = router;
