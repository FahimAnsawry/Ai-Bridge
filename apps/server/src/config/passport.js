const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { User, UserConfig, Provider } = require('./db');
const { DEFAULTS } = require('./config');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy-client-id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret',
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    // Guard against DB disconnection
    if (require('./db').mongoose.connection.readyState !== 1) {
      console.warn('[passport] DB not connected, logging in as mock guest user');
      return done(null, {
        _id: '000000000000000000000000',
        email: profile.emails?.[0]?.value || 'guest@local.host',
        role: 'admin',
        displayName: profile.displayName + ' (Guest Mode)'
      });
    }

    try {
      let user = await User.findOne({ googleId: profile.id });

      if (user) {
        user.lastLoginAt = new Date();
        user.displayName = profile.displayName || user.displayName;
        user.avatar = profile.photos?.[0]?.value || user.avatar;
        await user.save();
        return done(null, user);
      }

      // Check if user exists by email but without googleId
      const email = profile.emails?.[0]?.value;
      if (email) {
        user = await User.findOne({ email });
        if (user) {
          user.googleId = profile.id;
          user.displayName = profile.displayName;
          user.avatar = profile.photos?.[0]?.value;
          user.lastLoginAt = new Date();
          await user.save();
          return done(null, user);
        }
      }

      // Create new user
      user = new User({
        googleId: profile.id,
        email: email || `${profile.id}@google.oauth.dummy`,
        displayName: profile.displayName,
        avatar: profile.photos?.[0]?.value,
        lastLoginAt: new Date(),
        activeProviderId: null,
        config: {
          port: DEFAULTS.port,
          corsOrigins: DEFAULTS.cors_origins,
          modelRouting: DEFAULTS.model_routing,
          modelMapping: DEFAULTS.model_mapping,
          stubModels: DEFAULTS.stub_models
        },
        providers: []
      });
      user.generateAccessKey(); // Generate initial access key
      user.isNewUser = true; // Flag for the first login
      await user.save();

      // Create initial UserConfig and Providers for the new user
      try {
        await UserConfig.create({
          userId: user._id,
          port: DEFAULTS.port,
          corsOrigins: DEFAULTS.cors_origins,
          modelRouting: DEFAULTS.model_routing,
          modelMapping: new Map(Object.entries(DEFAULTS.model_mapping)),
          stubModels: DEFAULTS.stub_models,
          activeProviderId: null
        });

        // No initial providers created on signup - user must add them manually
      } catch (initErr) {
        console.error('[passport] Failed to initialize UserConfig/Providers:', initErr.message);
        // We don't fail the login if this fails, but it's bad.
      }

      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

passport.serializeUser((user, done) => {
  const id = user.id || user._id;
  done(null, id);
});

passport.deserializeUser(async (id, done) => {
  // Guard against DB disconnection
  if (require('./db').mongoose.connection.readyState !== 1) {
    return done(null, {
      _id: '000000000000000000000000',
      email: 'guest@local.host',
      role: 'admin',
      displayName: 'Guest (No DB Mode)'
    });
  }

  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
