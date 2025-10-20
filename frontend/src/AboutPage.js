import React from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Code, 
  Database, 
  Brain, 
  BarChart3, 
  Clock, 
  MapPin, 
  Zap,
  Github,
  Linkedin,
  Mail,
  Award,
  Target,
  TrendingUp,
  Shield,
  Globe
} from 'lucide-react';

const AboutPage = () => {
  const timeline = [
    {
      step: 1,
      title: "Problem Identification",
      description: "Identified the need for accurate bus delay prediction in Madison's public transit system",
      icon: Target,
      details: [
        "Analyzed existing transit data challenges",
        "Researched Madison Metro API capabilities",
        "Identified gaps in real-time prediction accuracy"
      ]
    },
    {
      step: 2,
      title: "Data Collection Strategy",
      description: "Designed and implemented a comprehensive data collection system",
      icon: Database,
      details: [
        "Built automated API collection system",
        "Implemented adaptive scheduling (2-30 min intervals)",
        "Created data validation and error recovery",
        "Collected 100,000+ prediction records across 19 routes"
      ]
    },
    {
      step: 3,
      title: "Feature Engineering",
      description: "Developed 20+ features for machine learning models",
      icon: Code,
      details: [
        "Temporal features: time of day, day of week, seasonality",
        "Spatial features: route type, stop location, traffic patterns",
        "Contextual features: weather, passenger load, historical delays",
        "Real-time features: current speed, GPS coordinates"
      ]
    },
    {
      step: 4,
      title: "Model Development",
      description: "Trained and optimized multiple ML models",
      icon: Brain,
      details: [
        "Implemented 5 different algorithms (XGBoost, LightGBM, Neural Networks, etc.)",
        "Performed hyperparameter tuning with cross-validation",
        "Achieved 87.5% accuracy with 1.79 minute MAE",
        "17.5% improvement over baseline predictions"
      ]
    },
    {
      step: 5,
      title: "Full-Stack Development",
      description: "Built production-ready web application",
      icon: Globe,
      details: [
        "React frontend with modern UI/UX design",
        "Flask REST API with comprehensive endpoints",
        "Real-time data visualization and analytics",
        "Responsive design for all devices"
      ]
    },
    {
      step: 6,
      title: "Deployment & Monitoring",
      description: "Deployed to cloud platforms with monitoring",
      icon: Shield,
      details: [
        "Deployed backend to Railway (free tier)",
        "Deployed frontend to Vercel (free tier)",
        "Implemented error handling and logging",
        "Set up continuous integration pipeline"
      ]
    }
  ];

  const skills = [
    { category: "Data Science", items: ["Python", "Pandas", "NumPy", "Scikit-learn", "XGBoost", "LightGBM", "TensorFlow"] },
    { category: "Web Development", items: ["React", "JavaScript", "HTML/CSS", "Flask", "REST APIs", "JSON"] },
    { category: "Data Visualization", items: ["Chart.js", "Recharts", "Plotly", "Matplotlib", "Seaborn"] },
    { category: "Deployment", items: ["Railway", "Vercel", "Docker", "Git", "GitHub", "CI/CD"] },
    { category: "Data Collection", items: ["API Integration", "Web Scraping", "Data Validation", "Error Handling"] }
  ];

  const achievements = [
    {
      icon: Award,
      title: "87.5% Prediction Accuracy",
      description: "Achieved industry-leading accuracy for bus delay prediction"
    },
    {
      icon: Database,
      title: "100,000+ Data Points",
      description: "Collected and processed massive real-time dataset"
    },
    {
      icon: Zap,
      title: "Real-Time Processing",
      description: "Sub-minute prediction updates with live data"
    },
    {
      icon: TrendingUp,
      title: "17.5% Improvement",
      description: "Significant improvement over baseline predictions"
    }
  ];

  return (
    <div className="about-page">
      {/* Hero Section */}
      <motion.section 
        className="hero-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="hero-content">
           <div className="profile-section">
             <div className="profile-avatar">
               <img 
                 src="/profile-photo.jpg" 
                 alt="Nils Matteson" 
                 className="profile-photo"
                 onError={(e) => {
                   e.target.style.display = 'none';
                   e.target.nextSibling.style.display = 'block';
                 }}
               />
               <User className="avatar-icon fallback-icon" style={{display: 'none'}} />
             </div>
            <div className="profile-info">
              <h1>Nils Matteson</h1>
              <h2>Data Science & Computer Science Student</h2>
               <p className="profile-description">
                 Data science student focused on building practical ML solutions. 
                 Majoring in Data Science with a Computer Science minor at UW-Madison.
               </p>
              <div className="contact-links">
                <a href="https://github.com/matteso1" className="contact-link">
                  <Github className="contact-icon" />
                  GitHub
                </a>
                <a href="https://www.linkedin.com/in/nils-matteson-198326249/" className="contact-link">
                  <Linkedin className="contact-icon" />
                  LinkedIn
                </a>
                <a href="mailto:nomatteson@wisc.edu" className="contact-link">
                  <Mail className="contact-icon" />
                  Email
                </a>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Project Overview */}
      <motion.section 
        className="project-overview"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <h2>About This Project</h2>
        <div className="overview-grid">
          <div className="overview-card">
            <MapPin className="overview-icon" />
            <h3>Real-World Impact</h3>
             <p>
               Real-time bus delay prediction system for Madison Metro. Uses live API data 
               and machine learning to provide accurate arrival estimates for commuters.
             </p>
          </div>
          <div className="overview-card">
            <Brain className="overview-icon" />
            <h3>Technical Innovation</h3>
            <p>
              Built with XGBoost, LightGBM, and neural networks. Features comprehensive 
              data collection, feature engineering, and a full-stack web application.
            </p>
          </div>
          <div className="overview-card">
            <BarChart3 className="overview-icon" />
            <h3>Data-Driven Insights</h3>
            <p>
              Analyzed 100,000+ prediction records to identify delay patterns, route performance, 
              and temporal trends. Data-driven insights for transit planning and operations.
            </p>
          </div>
        </div>
      </motion.section>

      {/* Process Timeline */}
      <motion.section 
        className="process-timeline"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        <h2>Development Process</h2>
        <div className="timeline">
          {timeline.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div 
                key={item.step}
                className="timeline-item"
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.6 + (index * 0.1) }}
              >
                <div className="timeline-marker">
                  <Icon className="timeline-icon" />
                  <span className="step-number">{item.step}</span>
                </div>
                <div className="timeline-content">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <ul className="timeline-details">
                    {item.details.map((detail, idx) => (
                      <li key={idx}>{detail}</li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* Technical Skills */}
      <motion.section 
        className="skills-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.8 }}
      >
        <h2>Technical Skills Demonstrated</h2>
        <div className="skills-grid">
          {skills.map((skill, index) => (
            <motion.div 
              key={skill.category}
              className="skill-category"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.0 + (index * 0.1) }}
            >
              <h3>{skill.category}</h3>
              <div className="skill-items">
                {skill.items.map((item, idx) => (
                  <span key={idx} className="skill-item">{item}</span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Key Achievements */}
      <motion.section 
        className="achievements-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.2 }}
      >
        <h2>Key Achievements</h2>
        <div className="achievements-grid">
          {achievements.map((achievement, index) => {
            const Icon = achievement.icon;
            return (
              <motion.div 
                key={index}
                className="achievement-card"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 1.4 + (index * 0.1) }}
              >
                <Icon className="achievement-icon" />
                <h3>{achievement.title}</h3>
                <p>{achievement.description}</p>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* Data Collection Details */}
      <motion.section 
        className="data-collection-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.6 }}
      >
        <h2>Data Collection Process</h2>
        <div className="data-details">
          <div className="data-card">
            <Clock className="data-icon" />
            <h3>Collection Schedule</h3>
            <ul>
              <li><strong>Morning Rush (7-8 AM):</strong> Every 2 minutes</li>
              <li><strong>Business Hours (9 AM-4 PM):</strong> Every 5 minutes</li>
              <li><strong>Evening Rush (5-7 PM):</strong> Every 2 minutes</li>
              <li><strong>Evening (8-10 PM):</strong> Every 10 minutes</li>
              <li><strong>Night (11 PM-6 AM):</strong> Every 30 minutes</li>
            </ul>
          </div>
          <div className="data-card">
            <Database className="data-icon" />
            <h3>Data Quality</h3>
            <ul>
              <li><strong>Completeness:</strong> 95.4% data completeness</li>
              <li><strong>API Calls:</strong> 9,500 calls per day (within limits)</li>
              <li><strong>Error Recovery:</strong> Automatic retry with exponential backoff</li>
              <li><strong>Validation:</strong> Real-time data quality checks</li>
            </ul>
          </div>
          <div className="data-card">
            <BarChart3 className="data-icon" />
            <h3>Data Volume</h3>
            <ul>
              <li><strong>Files:</strong> 1,880+ CSV files collected</li>
              <li><strong>Records:</strong> 100,000+ prediction records</li>
              <li><strong>Routes:</strong> 19 bus routes covered</li>
              <li><strong>Storage:</strong> ~500MB of structured data</li>
            </ul>
          </div>
        </div>
      </motion.section>

      {/* Future Plans */}
      <motion.section 
        className="future-plans"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.8 }}
      >
        <h2>Future Enhancements</h2>
        <div className="plans-grid">
          <div className="plan-card">
            <h3>Mobile App</h3>
            <p>Develop a React Native mobile app for on-the-go bus tracking</p>
          </div>
          <div className="plan-card">
            <h3>Weather Integration</h3>
            <p>Incorporate weather data to improve delay predictions</p>
          </div>
          <div className="plan-card">
            <h3>Real-Time Database</h3>
            <p>Migrate to PostgreSQL for better data management</p>
          </div>
          <div className="plan-card">
            <h3>Advanced ML</h3>
            <p>Implement LSTM networks for time series prediction</p>
          </div>
        </div>
      </motion.section>
    </div>
  );
};

export default AboutPage;
