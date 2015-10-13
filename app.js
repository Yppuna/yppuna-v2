var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var passport = require('passport');
var validate = require('form-validate');
var i18n = require('i18n');
i18n.configure({
    defaultLocale: 'ko',
    directory: path.join(__dirname, 'locales')
});
var app = express();

var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var LocalStrategy = require('passport-local').Strategy;
var FacebookStrategy = require('passport-facebook').Strategy;
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/dailyboom');
var User = require('./models/user');
//var materialize = require('materialize-css');

var routes = require('./routes/index');
var users = require('./routes/users');
var products = require('./routes/products');
var orders = require('./routes/orders');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'vash');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
var validateOptions = {
  i18n: {
    defaultLocale: 'ko',
    directory: path.join(__dirname, 'locales')
  }
}
app.use(logger('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser('keyboard cat'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({ secret: 'keyboard cat', name: 'session_id', saveUninitialized: true, resave: true })); // store: new RedisStore({ host: '127.0.0.1',  port: 6379 }),
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(validate(app, validateOptions))
//app.use(i18n.middleware());
app.use(passport.initialize());
app.use(passport.session());
app.use(function(req, res, next) {
  res.locals.user = req.user;
  next();
});
app.use('/', routes);
app.use('/', users);
app.use('/', products);
app.use('/', orders);

passport.use(new LocalStrategy(
  function (username, password, done) {
    User.findOne({ username: username }, function (err, user) {
      console.log(username + '/' + password);
      if (err) { return done(err); }
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      user.comparePassword(password, function(err, isMatch) {
        console.log(isMatch);
        if (err) { return done(err); }
        if (isMatch === false) {
          return done(null, false, { message: 'Incorrect password.' });
        }
        else {
          return done(null, user);
        }
      });
    });
  }
));

passport.use(new FacebookStrategy({
    clientID: "636096523200038",
    clientSecret: "9980ae2e967b246bef211729d57d4e5f",
    callbackURL: "http://localhost:3000/auth/facebook/callback",
    enableProof: false
  },
  function(accessToken, refreshToken, profile, done) {
     //check user table for anyone with a facebook ID of profile.id
      User.findOne({
          'facebookId': profile.id 
      }, function(err, user) {
          if (err) {
              return done(err);
          }
          //No user was found... so create a new user with values from Facebook (all the profile. stuff)
          if (!user) {
              console.log(profile);
              user = new User({
                  name: profile.displayName,
                  email: profile.email,
                  username: 'DBU'+profile.id,
                  role: 'user',
                  //now in the future searching on User.findOne({'facebook.id': profile.id } will match because of this next line
                  facebookId: profile.id
              });
              user.save(function(err) {
                  if (err) console.log(err);
                  return done(err, user);
              });
          } else {
              //found user. Return
              return done(err, user);
          }
      });
  }
));

passport.serializeUser(function(user, done) {
  done(null, user._id);
});
 
passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    console.log(user);
    done(err, user);
  });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});


module.exports = app;
