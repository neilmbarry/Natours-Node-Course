const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const crypto = require('crypto');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const sendEmail = require('../utils/email');
// const APIFeatures = require('../utils/apiFeatures');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),

    httpOnly: true,
  };
  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

  res.cookie('jwt', token, cookieOptions);

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    role: req.body.role,
  });

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1. Check if email and password exist
  if (!email || !password) {
    const error = new AppError('No email or password', 400);
    return next(error);
  }

  // 2. Check if user exists && password is correct
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    const error = new AppError('Incorrect email or password', 401);
    return next(error);
  }

  // 3. If everything okay, send token to client
  createSendToken(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
  // 1. Getting the token and check if it's there

  //--------- NEEDS TO BE THOROUGHLY TESTED --------//
  const token =
    (req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer') &&
      req.headers.authorization.split(' ')[1]) ||
    req.cookies.jwt;
  //----------------------------------------------//

  if (!token) {
    return next(new AppError('You are not logged in!', 401));
  }
  // 2. Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3. Check if user still exists
  const freshUser = await User.findById(decoded.id);

  if (!freshUser)
    return next(
      new AppError('The user belonging to the token no longer exists', 401)
    );

  //4. Check uf user changed password after the token was issued

  if (await freshUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again', 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = freshUser;
  next();
});

// TO BE USED WITH PUG TEMPLATES
exports.isLoggedIn = catchAsync(async (req, res, next) => {
  // 1. Getting the token and check if it's there

  if (req.cookies.jwt) {
    const decoded = await promisify(jwt.verify)(
      req.cookies.jwt,
      process.env.JWT_SECRET
    );
    const freshUser = await User.findById(decoded.id);

    if (!freshUser) return next();

    if (await freshUser.changedPasswordAfter(decoded.iat)) {
      return next();
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    res.locals.user = freshUser;
    return next();
  }

  next();
});

exports.restrictTo =
  (...roles) =>
  (req, res, next) => {
    // roles ['admin','lead-guild']

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }
    next();
  };

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new AppError('There is no user with that email address.', 404));
  }
  // 2. Generate the random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3. Send it to user's email
  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/resetPassword/${resetToken}`;

  const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;

  try {
    await sendEmail({
      subject: 'Your password reset token (valid for 10 min)',
      message,
      email: user.email,
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError('There was an error sending the email. Try again later!'),
      500
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Token sent to email!',
  });
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1. Get user based on the token

  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  // console.log(hashedToken);
  const user = await User.findOne({ passwordResetToken: hashedToken });
  if (!user) {
    return next(new AppError('Could not find user. Please try again!'), 400);
  }
  // 2. If token has not expired and this is user, set the new password
  if (user.tokenExpired()) {
    return next(new AppError('Sorry your token has expired!', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;

  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  // 3. Update changedPasswordAt property for the user

  await user.save();
  // 4. Log the user in, send JWT
  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1. Get user from collection
  const user = await User.findById(req.user.id).select('+password');
  if (!user) {
    return next(new AppError("Couldn't find user!"));
  }
  // 2. Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
    return next(new AppError('Incorrect password!', 401));
  }
  // 3. If so, update password
  user.password = req.body.newPassword;
  user.passwordConfirm = req.body.newPasswordConfirm;
  await user.save();
  // 4. Log user in, send JWT
  createSendToken(user, 200, res);
});
