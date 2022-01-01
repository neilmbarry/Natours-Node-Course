const express = require('express');
const useController = require('../controllers/userController');

const router = express.Router();

router.route('/').get(useController.getAllUsers).post(useController.createUser);

router
  .route('/:id')
  .get(useController.getUser)
  .patch(useController.updateUser)
  .delete(useController.deleteUser);

module.exports = router;
