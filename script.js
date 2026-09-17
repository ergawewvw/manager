const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

// Elementlar
const menuButtons = document.querySelectorAll(".menu-btn");
const panel = document.getElementById("panel");
const pageTitle = document.getElementById("page-title");

// Ma'lumotlar
const pages = {
  dashboard: {
    title: "Dashboard",
    content: `
      <div class="page-heading">
        <div>
          <h2>Welcome back 👋</h2>
          <p>Manage your tasks and stay productive.</p>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Total Tasks</span>
          <strong id="totalTasks">0</strong>
          <small>All your tasks</small>
        </div>

        <div class="stat-card">
          <span class="stat-label">Completed</span>
          <strong id="completedTasks">0</strong>
          <small>Finished tasks</small>
        </div>

        <div class="stat-card">
          <span class="stat-label">Pending</span>
          <strong id="pendingTasks">0</strong>
          <small>Tasks in progress</small>
        </div>
      </div>

      <div class="content-card">
        <div class="card-header">
          <h3>Recent Tasks</h3>
          <button class="primary-btn" id="addTaskBtn">+ Add Task</button>
        </div>

        <div id="taskList" class="task-list">
          <p class="empty-text">No tasks yet. Add your first task.</p>
        </div>
      </div>
    `
  },

  tasks: {
    title: "Tasks",
    content: `
      <div class="page-heading">
        <div>
          <h2>My Tasks</h2>
          <p>Create and manage your daily tasks.</p>
        </div>
        <button class="primary-btn" id="addTaskBtn">+ Add Task</button>
      </div>

      <div class="content-card">
        <div id="taskList" class="task-list">
          <p class="empty-text">No tasks yet.</p>
        </div>
      </div>
    `
  },

  completed: {
    title: "Completed Tasks",
    content: `
      <div class="page-heading">
        <div>
          <h2>Completed Tasks</h2>
          <p>All tasks you have finished.</p>
        </div>
      </div>

      <div class="content-card">
        <div id="taskList" class="task-list">
          <p class="empty-text">No completed tasks yet.</p>
        </div>
      </div>
    `
  },

  settings: {
    title: "Settings",
    content: `
      <div class="page-heading">
        <div>
          <h2>Settings</h2>
          <p>Customize your task manager.</p>
        </div>
      </div>

      <div class="content-card settings-card">
        <label>
          Your name
          <input type="text" id="userName" placeholder="Enter your name">
        </label>

        <button class="primary-btn" id="saveSettings">
          Save Settings
        </button>

        <p id="settingsMessage"></p>
      </div>
    `
  }
};

// Tasklar
let tasks = JSON.parse(localStorage.getItem("managerTasks")) || [];

// Saqlash
function saveTasks() {
  localStorage.setItem("managerTasks", JSON.stringify(tasks));
}

// Sahifani ochish
function openPage(pageName) {
  const page = pages[pageName];

  if (!page) return;

  if (pageTitle) {
    pageTitle.textContent = page.title;
  }

  panel.innerHTML = page.content;

  menuButtons.forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName
    );
  });

  renderTasks(pageName);
  setupPageEvents();
}

// Tasklarni chiqarish
function renderTasks(pageName = "dashboard") {
  const taskList = document.getElementById("taskList");

  if (!taskList) return;

  let visibleTasks = tasks;

  if (pageName === "completed") {
    visibleTasks = tasks.filter(task => task.completed);
  }

  if (visibleTasks.length === 0) {
    taskList.innerHTML = `
      <p class="empty-text">No tasks available.</p>
    `;
  } else {
    taskList.innerHTML = visibleTasks.map(task => `
      <div class="task-item ${task.completed ? "completed" : ""}">
        <div class="task-info">
          <h4>${escapeHTML(task.title)}</h4>
          <p>${escapeHTML(task.description || "No description")}</p>
        </div>

        <div class="task-actions">
          <button 
            class="complete-btn" 
            data-id="${task.id}"
          >
            ${task.completed ? "Undo" : "Complete"}
          </button>

          <button 
            class="delete-btn" 
            data-id="${task.id}"
          >
            Delete
          </button>
        </div>
      </div>
    `).join("");
  }

  updateStats();
  setupTaskButtons();
}

// Statistikani yangilash
function updateStats() {
  const totalTasks = document.getElementById("totalTasks");
  const completedTasks = document.getElementById("completedTasks");
  const pendingTasks = document.getElementById("pendingTasks");

  if (totalTasks) {
    totalTasks.textContent = tasks.length;
  }

  if (completedTasks) {
    completedTasks.textContent =
      tasks.filter(task => task.completed).length;
  }

  if (pendingTasks) {
    pendingTasks.textContent =
      tasks.filter(task => !task.completed).length;
  }
}

// Task qo‘shish oynasi
function addTask() {
  const title = prompt("Task nomini kiriting:");

  if (!title || !title.trim()) return;

  const description = prompt("Task haqida qisqacha yozing:") || "";

  const newTask = {
    id: Date.now(),
    title: title.trim(),
    description: description.trim(),
    completed: false
  };

  tasks.push(newTask);
  saveTasks();

  renderTasks();
}

// Task tugmalari
function setupTaskButtons() {
  document.querySelectorAll(".complete-btn").forEach(button => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id);

      tasks = tasks.map(task => {
        if (task.id === id) {
          return {
            ...task,
            completed: !task.completed
          };
        }

        return task;
      });

      saveTasks();
      renderTasks();
    });
  });

  document.querySelectorAll(".delete-btn").forEach(button => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id);

      tasks = tasks.filter(task => task.id !== id);

      saveTasks();
      renderTasks();
    });
  });
}

// Sahifa ichidagi tugmalar
function setupPageEvents() {
  const addTaskBtn = document.getElementById("addTaskBtn");

  if (addTaskBtn) {
    addTaskBtn.addEventListener("click", addTask);
  }

  const saveSettings = document.getElementById("saveSettings");

  if (saveSettings) {
    saveSettings.addEventListener("click", () => {
      const userName = document.getElementById("userName");
      const settingsMessage = document.getElementById("settingsMessage");

      localStorage.setItem("managerUserName", userName.value);

      settingsMessage.textContent = "Settings saved successfully!";
    });
  }

  const userName = document.getElementById("userName");

  if (userName) {
    userName.value =
      localStorage.getItem("managerUserName") || "";
  }
}

// HTML xavfsizligi
function escapeHTML(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Menyu
menuButtons.forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

// Boshlang‘ich sahifa
openPage("dashboard");
